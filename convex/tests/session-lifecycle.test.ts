// The Session lifecycle, and the guarantees that only hold if it is robust.
//
// The tests here are all about what happens when the browser does not play its
// part: never reports the start, keeps the call open after ending, stops
// flushing the Transcript, or simply disappears. INV-4 is enforced from a
// Session's duration and its spend, and both of those used to exist only when a
// client volunteered them — which is to say the caps were enforced against
// clients that chose to be counted.
//
// Fake timers throughout. The whole subject is *when* things happen relative to
// a server-stamped clock, and convex-test's `_creationTime` follows `Date.now()`
// so a Session can be aged deliberately rather than by sleeping.

import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  SEAL_DELAY_SEC,
  TIMEBOX_HANGUP_GRACE_SEC,
  TIMEBOX_SWEEP_SLACK_SEC,
} from "../lib/constants";
import {
  OPERATOR_DID,
  STUDENT_DID,
  seedWorld,
} from "../../test/invariants/world";

const modules = import.meta.glob("../**/*.ts");

type World = Awaited<ReturnType<typeof seedWorld>>;

const INV4 = "INV-4 (spend is capped in code)";

/** The Session row, straight from the database. */
async function sessionRow(t: World["t"], sessionId: Id<"sessions">) {
  return await t.run(async (ctx) => await ctx.db.get("sessions", sessionId));
}

/** Every `spendEvents` row written for one Session. */
async function spendFor(t: World["t"], sessionId: Id<"sessions">) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("spendEvents").collect()).filter(
      (event) => event.sessionId === sessionId,
    ),
  );
}

/** The scheduler's queue, as `{ name, scheduledTime }`. */
async function scheduledJobs(t: World["t"]) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).map((job) => ({
      name: job.name,
      scheduledTime: job.scheduledTime,
    })),
  );
}

/** One Transcript turn, as the browser sends it. */
function turn(itemId: string, orderKey: number) {
  return {
    itemId,
    orderKey,
    speaker: "student" as const,
    text: `Turn ${orderKey}: the Student is speaking.`,
    textStatus: "final" as const,
  };
}

// ---------------------------------------------------------------------------
// The INV-4 bypass: a Session that never calls `sessions.start`
// ---------------------------------------------------------------------------

describe("INV-4 — a Session is counted whether or not the client reports it", () => {
  test("a Transcript written without ever calling `start` starts the Session on the server clock", async () => {
    vi.useFakeTimers();
    try {
      const { t, ids } = await seedWorld(modules, { sessionsPerDay: 5 });
      const student = t.withIdentity({ subject: STUDENT_DID });
      const prepared = await student.mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) {
        return;
      }

      // The whole attack: skip `sessions.start` entirely. The browser already
      // has its `ek_` secret and talks to OpenAI directly, so nothing but our
      // own bookkeeping depends on this call being made.
      const minted = await sessionRow(t, prepared.sessionId);
      expect(minted?.status).toBe("minted");
      expect(minted?.startedAt).toBeUndefined();

      vi.advanceTimersByTime(30_000);
      const upsert = await student.mutation(api.transcript.upsert, {
        sessionId: prepared.sessionId,
        items: [turn("item-1", 1)],
      });
      expect(upsert.accepted).toBe(true);

      const started = await sessionRow(t, prepared.sessionId);
      expect(
        started?.status,
        `${INV4} BROKEN: persisted Transcript material is proof that the call ` +
          "is up, and the Session is still `minted`. A Session with no " +
          "`startedAt` has no duration, so it neither counts against the caps " +
          "nor records the realtime spend it is actually incurring.",
      ).toBe("live");
      expect(
        started?.startedAt,
        "The inferred start is the Session's own mint time — a server-stamped " +
          "fact the client cannot influence — not the moment the write landed.",
      ).toBe(minted?._creationTime);
      expect(started?.startInferred).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("that Session then counts against the caps and records its real spend", async () => {
    vi.useFakeTimers();
    try {
      // The world seeds one counting Session, so this is the Student's second
      // of two: allowed now, and it must be their last.
      const { t, ids } = await seedWorld(modules, {
        sessionsPerDay: 2,
        minDurationSec: 180,
      });
      const student = t.withIdentity({ subject: STUDENT_DID });
      const prepared = await student.mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
      if (!prepared.ok) {
        throw new Error("the mint was refused; this test needs it allowed");
      }

      await student.mutation(api.transcript.upsert, {
        sessionId: prepared.sessionId,
        items: [turn("item-1", 1)],
      });
      // A full ten-minute examination, and not one word of it reported.
      vi.advanceTimersByTime(600_000);
      const result = await t.mutation(internal.sessions.finalize, {
        sessionId: prepared.sessionId,
        endReason: "disconnected",
      });

      expect(
        result?.durationSec,
        `${INV4} BROKEN: a Session that ran ten minutes was recorded as zero ` +
          "seconds because the client never reported a start.",
      ).toBeGreaterThan(500);
      expect(
        result?.countsAgainstCaps,
        `${INV4} BROKEN: the caps were bypassed. A Student who omits one ` +
          "mutation gets unlimited graded Sessions.",
      ).toBe(true);

      const spend = await spendFor(t, prepared.sessionId);
      expect(spend).toHaveLength(1);
      expect(
        spend[0].usd,
        `${INV4} edge (c) BROKEN: real realtime minutes were recorded as $0, ` +
          "so the breaker cannot see them and the monthly budget is fiction.",
      ).toBeGreaterThan(0);

      // And the cap is really spent: the next mint is refused.
      const next = await student.mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
      expect(next.ok).toBe(false);
      if (!next.ok) {
        expect(next.reason).toBe("day_cap");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  test("finalize infers the start for a Session with a Transcript even if nothing else did", async () => {
    vi.useFakeTimers();
    try {
      const { t, ids } = await seedWorld(modules, { minDurationSec: 180 });
      const sessionId = await t.run(async (ctx) => {
        const id = await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "minted",
        });
        // Written straight to the table, so no write path adopted the Session.
        await ctx.db.insert("transcriptItems", {
          sessionId: id,
          itemId: "item-1",
          orderKey: 1,
          speaker: "examiner",
          text: "What is your response to this Assignment, and why?",
          textStatus: "final",
        });
        return id;
      });

      vi.advanceTimersByTime(400_000);
      const result = await t.mutation(internal.sessions.finalize, {
        sessionId,
        endReason: "disconnected",
      });
      expect(result?.durationSec).toBeGreaterThan(300);
      expect(result?.countsAgainstCaps).toBe(true);
      const row = await sessionRow(t, sessionId);
      expect(row?.startedAt).toBe(row?._creationTime);
      expect(row?.startInferred).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a Session with no Transcript at all is still forgiven — the drop, not the attempt", async () => {
    vi.useFakeTimers();
    try {
      const { t, ids } = await seedWorld(modules, { minDurationSec: 180 });
      const sessionId = await t.run(
        async (ctx) =>
          await ctx.db.insert("sessions", {
            studentId: ids.studentId,
            assignmentVersionId: ids.assignmentVersionId,
            status: "minted",
          }),
      );
      vi.advanceTimersByTime(400_000);
      const result = await t.mutation(internal.sessions.finalize, {
        sessionId,
        endReason: "disconnected",
      });
      expect(
        result?.countsAgainstCaps,
        `${INV4} edge (a) BROKEN: closing the start-report bypass started ` +
          "punishing the Student whose connection never came up. A Session " +
          "that produced nothing produced nothing.",
      ).toBe(false);
      expect(result?.durationSec).toBe(0);
      expect((await sessionRow(t, sessionId))?.startedAt).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("`start` after the server adopted a Session records the call id and does not move the start", async () => {
    vi.useFakeTimers();
    try {
      const { t, ids } = await seedWorld(modules, { sessionsPerDay: 5 });
      const student = t.withIdentity({ subject: STUDENT_DID });
      const prepared = await student.mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
      if (!prepared.ok) {
        throw new Error("the mint was refused; this test needs it allowed");
      }
      await student.mutation(api.transcript.upsert, {
        sessionId: prepared.sessionId,
        items: [turn("item-1", 1)],
      });
      const adopted = await sessionRow(t, prepared.sessionId);

      vi.advanceTimersByTime(5_000);
      const started = await student.mutation(api.sessions.start, {
        sessionId: prepared.sessionId,
        openaiCallId: "rtc_late_report",
      });
      expect(
        started.startedAt,
        "A reported start may never move an established one: that is exactly " +
          "how a client would lengthen its own time-box.",
      ).toBe(adopted?.startedAt);
      const row = await sessionRow(t, prepared.sessionId);
      expect(row?.openaiCallId).toBe("rtc_late_report");
      expect(row?.startInferred).toBe(false);

      // And it cannot be started a third time.
      await expect(
        student.mutation(api.sessions.start, {
          sessionId: prepared.sessionId,
        }),
      ).rejects.toThrow(/already live/);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Ending a Session ends the call
// ---------------------------------------------------------------------------

describe("ending a Session ends the OpenAI call", () => {
  test.each([
    ["the Student's own control", "student_request"],
    ["the Examiner's end_session tool", "dead_threads"],
    ["a reported disconnect", "disconnected"],
  ] as const)("%s schedules the hangup", async (_label, reason) => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 120_000,
          openaiCallId: "rtc_open_leg",
        }),
    );
    await t
      .withIdentity({ subject: STUDENT_DID })
      .mutation(api.sessions.end, { sessionId, reason });

    const jobs = await scheduledJobs(t);
    expect(
      jobs.map((job) => job.name),
      "Ending a Session must end the CALL. Finalizing writes rows; the audio " +
        "leg lives at OpenAI, and a browser that keeps its WebRTC connection " +
        "open goes on being examined to the platform's own 60-minute cap — " +
        "past the Transcript write window, so unrecorded, ungraded, " +
        "un-audited for INV-1 and unbilled against the breaker.",
    ).toContain("examiner/realtime:hangupCall");
  });

  test("a Session with no call id schedules no hangup, and still ends", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 120_000,
        }),
    );
    const result = await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "student_hangup",
    });
    expect(result?.alreadyEnded).toBe(false);
    const jobs = await scheduledJobs(t);
    expect(jobs.map((job) => job.name)).not.toContain(
      "examiner/realtime:hangupCall",
    );
  });

  test("an already-ended Session is not hung up twice", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "ended",
          startedAt: Date.now() - 600_000,
          endedAt: Date.now(),
          endReason: "student_hangup",
          countsAgainstCaps: true,
          openaiCallId: "rtc_already_gone",
        }),
    );
    const result = await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "timebox",
    });
    expect(result?.alreadyEnded).toBe(true);
    expect((await scheduledJobs(t)).map((job) => job.name)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The seal: grading a Transcript that has finished arriving
// ---------------------------------------------------------------------------

describe("the Grader reads a Transcript that has stopped being written", () => {
  test("finalize opens no Assessment; the seal does, after the write window", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "live",
        startedAt: Date.now() - 600_000,
      });
      await ctx.db.insert("transcriptItems", {
        sessionId: id,
        itemId: "item-1",
        orderKey: 1,
        speaker: "student",
        text: "My position is that credibility dominates.",
        textStatus: "final",
      });
      return id;
    });

    await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "timebox",
    });
    const immediately = await t.run(async (ctx) =>
      ctx.db
        .query("assessments")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .unique(),
    );
    expect(
      immediately,
      "The server accepts Transcript writes for TIMEBOX_GRACE_SEC past the " +
        "end. Grading before that window closes grades a record that is still " +
        "arriving — the closing exchange rated `not_probed` for material that " +
        "was spoken and persisted.",
    ).toBeNull();

    const seal = await scheduledJobs(t);
    const sealJob = seal.find((job) => job.name === "sessions:sealSession");
    expect(sealJob).toBeDefined();
    expect(
      (sealJob?.scheduledTime ?? 0) - Date.now(),
      "The seal has to land after the write window, not before it.",
    ).toBeGreaterThan((SEAL_DELAY_SEC - 5) * 1000);

    const sealed = await t.mutation(internal.sessions.sealSession, {
      sessionId,
    });
    expect(sealed.openedAssessment).toBe(true);
  });

  test("a Transcript whose first flush lands after the end still gets an Assessment", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 90_000,
        }),
    );
    // Ends before any flush has landed — a short Session, or a debounce that
    // had not fired.
    await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "student_hangup",
    });
    // The flush arrives inside the grace the server grants it.
    const accepted = await t
      .withIdentity({ subject: STUDENT_DID })
      .mutation(api.transcript.upsert, {
        sessionId,
        items: [turn("item-1", 1), turn("item-2", 2)],
      });
    expect(accepted.accepted).toBe(true);

    const sealed = await t.mutation(internal.sessions.sealSession, {
      sessionId,
    });
    expect(
      sealed.openedAssessment,
      "Deciding at the end that a Session had no Transcript loses the " +
        "Assessment for every Session whose last flush had not landed yet, " +
        "and leaves a Teacher to notice and retry by hand.",
    ).toBe(true);
    expect(sealed.items).toBe(2);
  });

  test("a Session with no Transcript when the window closes gets no Assessment", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "ended",
          startedAt: Date.now() - 60_000,
          endedAt: Date.now(),
          endReason: "disconnected",
          countsAgainstCaps: false,
        }),
    );
    const sealed = await t.mutation(internal.sessions.sealSession, {
      sessionId,
    });
    expect(sealed.openedAssessment).toBe(false);
    expect(sealed.items).toBe(0);
  });

  test("sealing twice does not open a second Assessment", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "ended",
        startedAt: Date.now() - 600_000,
        endedAt: Date.now(),
        endReason: "timebox",
        countsAgainstCaps: true,
      });
      await ctx.db.insert("transcriptItems", {
        sessionId: id,
        itemId: "item-1",
        orderKey: 1,
        speaker: "student",
        text: "A turn.",
        textStatus: "final",
      });
      return id;
    });
    const first = await t.mutation(internal.sessions.sealSession, {
      sessionId,
    });
    const second = await t.mutation(internal.sessions.sealSession, {
      sessionId,
    });
    expect(first.openedAssessment).toBe(true);
    expect(second.openedAssessment).toBe(false);
    const all = await t.run(async (ctx) =>
      ctx.db
        .query("assessments")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect(),
    );
    expect(all).toHaveLength(1);
  });

  test("the seal's Transcript counts match the rows, so the Operator's aggregates cannot drift", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 60_000,
        }),
    );
    await t.withIdentity({ subject: STUDENT_DID }).mutation(
      api.transcript.upsert,
      {
        sessionId,
        items: [
          turn("a", 1),
          turn("b", 2),
          {
            itemId: "c",
            orderKey: 3,
            speaker: "student" as const,
            text: "",
            textStatus: "failed" as const,
          },
        ],
      },
    );
    await t.mutation(internal.sessions.sealSession, { sessionId });

    const { row, actual, failed } = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("transcriptItems")
        .withIndex("by_session_order", (q) => q.eq("sessionId", sessionId))
        .collect();
      return {
        row: await ctx.db.get("sessions", sessionId),
        actual: rows.length,
        failed: rows.filter((r) => r.textStatus === "failed").length,
      };
    });
    expect(row?.transcriptItemCount).toBe(actual);
    expect(row?.transcriptFailedAsrCount).toBe(failed);

    // And that is what the Operator reads — no scan of `transcriptItems`.
    const metrics = await t
      .withIdentity({ subject: OPERATOR_DID })
      .query(api.operator.metrics, {});
    expect(metrics.transcript.items).toBe(2 + actual);
    expect(metrics.transcript.failedAsrItems).toBe(failed);
  });
});

// ---------------------------------------------------------------------------
// The time-box: two timers, and only one of them can be dropped
// ---------------------------------------------------------------------------

describe("the time-box survives a dropped scheduled action", () => {
  test("a mint arms both the at-most-once action and the exactly-once sweep", async () => {
    const { t, ids } = await seedWorld(modules, { sessionsPerDay: 5 });
    const prepared = await t
      .withIdentity({ subject: STUDENT_DID })
      .mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
    expect(prepared.ok).toBe(true);
    const names = (await scheduledJobs(t)).map((job) => job.name);
    expect(names).toContain("examiner/realtime:enforceTimebox");
    expect(
      names,
      "A scheduled ACTION runs at most once and is never retried. If the " +
        "hangup is the only timer, a dropped one leaves the Session `live` " +
        "forever: no end, no spendEvent, no Assessment, and counting against " +
        "the Student's caps for the whole rolling week.",
    ).toContain("sessions:sweepTimebox");
  });

  test("the sweep ends a Session whose hangup action never ran", async () => {
    vi.useFakeTimers();
    try {
      const { t, ids } = await seedWorld(modules, { timeboxSec: 900 });
      const sessionId = await t.run(
        async (ctx) =>
          await ctx.db.insert("sessions", {
            studentId: ids.studentId,
            assignmentVersionId: ids.assignmentVersionId,
            status: "live",
            startedAt: Date.now(),
          }),
      );
      vi.advanceTimersByTime(
        (900 + TIMEBOX_HANGUP_GRACE_SEC + TIMEBOX_SWEEP_SLACK_SEC + 1) * 1000,
      );
      const result = await t.mutation(internal.sessions.sweepTimebox, {
        sessionId,
      });
      expect(result?.endReason).toBe("timebox");
      expect((await sessionRow(t, sessionId))?.status).toBe("ended");
      expect(await spendFor(t, sessionId)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the sweep re-arms rather than cutting a Session short", async () => {
    const { t, ids } = await seedWorld(modules, { timeboxSec: 900 });
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 60_000,
        }),
    );
    const result = await t.mutation(internal.sessions.sweepTimebox, {
      sessionId,
    });
    expect(
      result,
      "The mint-time sweep fires at a fixed offset from the mint, so for a " +
        "Session that connected late it arrives early. Ending it there would " +
        "cut a Student short mid-examination.",
    ).toBeNull();
    expect((await sessionRow(t, sessionId))?.status).toBe("live");
    expect((await scheduledJobs(t)).map((job) => job.name)).toContain(
      "sessions:sweepTimebox",
    );
  });

  test("the sweep leaves an already-ended Session alone", async () => {
    const { t, ids } = await seedWorld(modules);
    const result = await t.mutation(internal.sessions.sweepTimebox, {
      sessionId: ids.sessionId,
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The hangup grace: the Examiner's closing line has somewhere to happen
// ---------------------------------------------------------------------------

describe("the scheduled hangup leaves room for a graceful ending", () => {
  test("`start` schedules the hangup past the time-box and says how far past", async () => {
    // Frozen clock: the assertion is about an exact offset, and a millisecond
    // of real time between the patch and the schedule would blur it.
    vi.useFakeTimers();
    try {
      const { t, ids } = await seedWorld(modules, {
        sessionsPerDay: 5,
        timeboxSec: 900,
      });
      const student = t.withIdentity({ subject: STUDENT_DID });
      const prepared = await student.mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
      if (!prepared.ok) {
        throw new Error("the mint was refused; this test needs it allowed");
      }
      const before = await scheduledJobs(t);
      const started = await student.mutation(api.sessions.start, {
        sessionId: prepared.sessionId,
        openaiCallId: "rtc_graceful",
      });

      expect(
        started.hangupGraceSec,
        "The page cannot know how long it may wait for the Examiner to close " +
          "things gracefully unless the server tells it. A hardcoded client " +
          "grace against a server that hangs up at the box exactly is a wait " +
          "for something that can never happen.",
      ).toBe(TIMEBOX_HANGUP_GRACE_SEC);

      const added = (await scheduledJobs(t)).filter(
        (job) =>
          job.name === "examiner/realtime:enforceTimebox" &&
          !before.some((old) => old.scheduledTime === job.scheduledTime),
      );
      expect(added).toHaveLength(1);
      expect(
        added[0].scheduledTime - started.endsAt,
        "Hanging up at `endsAt` exactly severs the audio while the Examiner " +
          "is saying its closing sentence — every expiring Session ends " +
          "mid-word.",
      ).toBe(TIMEBOX_HANGUP_GRACE_SEC * 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the write window outlasts the hangup, so the closing turn is still persistable", async () => {
    const { t, ids } = await seedWorld(modules, { timeboxSec: 900 });
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 100_000,
        }),
    );
    const state = await t.query(internal.sessions.timeboxState, { sessionId });
    expect(state?.hangupAt).toBe(
      (state?.cutoffAt ?? 0) + TIMEBOX_HANGUP_GRACE_SEC * 1000,
    );
    expect(state?.dueNow).toBe(false);
  });

  test("`getForStudent` reports the same grace the server enforces", async () => {
    const { t, ids } = await seedWorld(modules);
    const details = await t
      .withIdentity({ subject: STUDENT_DID })
      .query(api.sessions.getForStudent, { sessionId: ids.sessionId });
    expect(details.hangupGraceSec).toBe(TIMEBOX_HANGUP_GRACE_SEC);
  });
});

// ---------------------------------------------------------------------------
// A mint that could not buy a client secret
// ---------------------------------------------------------------------------

describe("a failed mint costs the Student nothing", () => {
  test("a client-secret failure ends the Session immediately rather than parking a cap slot", async () => {
    // The world seeds one counting Session; with a cap of two this mint is
    // allowed through the gate and then falls over at OpenAI, because this
    // suite deliberately has no API key.
    const { t, ids } = await seedWorld(modules, { sessionsPerDay: 2 });
    const student = t.withIdentity({ subject: STUDENT_DID });
    await expect(
      student.action(api.sessions.mintSession, {
        assignmentId: ids.assignmentId,
      }),
    ).rejects.toThrow(/OPENAI_API_KEY/);

    const stranded = await t.run(async (ctx) =>
      (await ctx.db.query("sessions").collect()).filter(
        (session) => session.status !== "ended",
      ),
    );
    expect(
      stranded,
      "A Session that will never be connected to must not sit `minted` " +
        "counting against the day cap until the backstop finalizes it " +
        "seventeen minutes later. An OpenAI outage plus two clicks would " +
        "otherwise tell a Student who did nothing wrong to come back " +
        "tomorrow.",
    ).toEqual([]);

    const retry = await student.mutation(internal.sessions.prepareMint, {
      assignmentId: ids.assignmentId,
    });
    expect(retry.ok).toBe(true);
  });
});
