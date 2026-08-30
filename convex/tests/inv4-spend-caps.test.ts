// INV-4 — Spend is capped in code.
//
// PRD §4: "Unlimited informal attempts + realtime voice pricing + fixed $5K
// grant = per-Student and global caps, enforced server-side at session mint."
//
// Edge semantics, which are the interesting half and each get a test here:
//   (a) Sessions under a minimum-duration floor do not burn an attempt — "the
//       mint cost is sunk but the Student is not punished".
//   (b) The breaker blocks new mints only. It never terminates a live Session.
//   (c) *All* model spend counts against the budget: realtime, Grader, and the
//       guardrail classifier.
//
// Done-means: a cap-exceeded mint request returns a friendly refusal; the
// budget breaker is tested; short-session cap-forgiveness is tested.
//
// The refusal tests deliberately go through the public `sessions.mintSession`
// action rather than the internal gate underneath it. A refusal that never
// reaches the Student is not a refusal, and this is also the proof that a
// refused mint costs nothing: the action returns before it ever asks OpenAI for
// a client secret, which is why this suite needs no API key.

import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  convexModules,
  describeHit,
  findAll,
  matching,
} from "../../test/invariants/sources";
import type { SourceMap } from "../../test/invariants/sources";
import { STUDENT_DID, seedWorld } from "../../test/invariants/world";

const INV4 = "INV-4 (spend is capped in code)";

const modules = import.meta.glob("../**/*.ts");

const convexSources = convexModules(
  import.meta.glob("../**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as SourceMap,
);

/**
 * The spend kinds, read from the schema rather than typed out here.
 *
 * Edge (c) is "*all* model spend counts", so the test that proves it has to be
 * written against whatever kinds exist, not against the two that exist today.
 * Add `classifier` to the schema and it is exercised on the next run.
 */
type SpendKind = Doc<"spendEvents">["kind"];

function spendKinds(): SpendKind[] {
  return schema.tables.spendEvents.validator.fields.kind.members.map(
    (member) => member.value,
  );
}

/** What a Student's world looked like before a refused mint. */
async function tally(t: Awaited<ReturnType<typeof seedWorld>>["t"]) {
  return await t.run(async (ctx) => ({
    sessions: (await ctx.db.query("sessions").collect()).length,
    spendEvents: (await ctx.db.query("spendEvents").collect()).length,
    assessments: (await ctx.db.query("assessments").collect()).length,
  }));
}

/**
 * Mint as the Student, and turn "the gate let this through" into a sentence
 * that says so.
 *
 * A mint that survives the INV-4 gate goes on to ask OpenAI for a client
 * secret, and there is no API key in this suite — by design, since the whole
 * point is that a refusal costs nothing. Left alone, a broken gate would
 * therefore fail these tests with "OPENAI_API_KEY is not set", which tells a
 * reader of a red CI run nothing about which guarantee is at risk.
 */
async function attemptMint(
  t: Awaited<ReturnType<typeof seedWorld>>["t"],
  assignmentId: Id<"assignments">,
) {
  try {
    return await t
      .withIdentity({ subject: STUDENT_DID })
      .action(api.sessions.mintSession, { assignmentId });
  } catch (error) {
    throw new Error(
      `${INV4}: this mint was not refused — it ran past the cap and breaker ` +
        "gate and got as far as buying a Realtime client secret, which is " +
        "real money and, here, a missing key. Underlying error: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

function expectFriendly(message: string, invariant: string): void {
  expect(
    message.length,
    `${invariant}: the refusal a Student reads is too short to explain ` +
      "anything.",
  ).toBeGreaterThan(40);
  for (const shouting of ["Error", "Forbidden", "undefined", "null"]) {
    expect(
      message,
      `${invariant}: the refusal reads like a stack trace, not like a ` +
        `sentence a Student who wants to work should read ("${shouting}").`,
    ).not.toContain(shouting);
  }
}

// ---------------------------------------------------------------------------
// (1) Caps — the friendly refusal
// ---------------------------------------------------------------------------

describe("INV-4 — a cap-exceeded mint is refused kindly and creates nothing", () => {
  test("the day cap: the Student is told when another Session becomes available", async () => {
    const { t, ids } = await seedWorld(modules, { sessionsPerDay: 2 });
    // The world seeds one counting Session; a second reaches the cap.
    await t.run(async (ctx) => {
      await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "ended",
        startedAt: Date.now() - 600_000,
        endedAt: Date.now(),
        endReason: "student_hangup",
        countsAgainstCaps: true,
      });
    });

    const before = await tally(t);
    const result = await attemptMint(t, ids.assignmentId);

    expect(
      result.ok,
      `${INV4}: a Student over the day cap was allowed to mint.`,
    ).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("day_cap");
    expectFriendly(result.message, INV4);
    expect(result.message).toContain("24 hours");
    // It also tells them the thing they most need to hear (edge (a)).
    expect(result.message).toContain("do not count");

    expect(
      await tally(t),
      `${INV4}: a refused mint created something. A refusal returns before ` +
        "any write: no Session row, no scheduled job, no spend.",
    ).toEqual(before);
  });

  test("the week cap: refused, and nothing created", async () => {
    const { t, ids } = await seedWorld(modules, {
      sessionsPerDay: 99,
      sessionsPerWeek: 2,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "ended",
        startedAt: Date.now() - 600_000,
        endedAt: Date.now(),
        endReason: "student_hangup",
        countsAgainstCaps: true,
      });
    });

    const before = await tally(t);
    const result = await attemptMint(t, ids.assignmentId);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("week_cap");
    expectFriendly(result.message, INV4);
    expect(await tally(t)).toEqual(before);
  });

  test("a Student under the caps is not refused", async () => {
    const { t, ids } = await seedWorld(modules, { sessionsPerDay: 5 });
    const prepared = await t
      .withIdentity({ subject: STUDENT_DID })
      .mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
    expect(
      prepared.ok,
      `${INV4}: the caps refused a Student who is under them. A cap that ` +
        "refuses everybody is not a cap, it is an outage.",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (2) The breaker — mints only, never a live Session
// ---------------------------------------------------------------------------

/** The deployment's month-to-date spend, summed the way the breaker sums it. */
async function monthToDateUsd(
  t: Awaited<ReturnType<typeof seedWorld>>["t"],
): Promise<number> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("spendEvents").collect()).reduce(
      (total, event) => total + event.usd,
      0,
    ),
  );
}

describe("INV-4 — the breaker blocks mints only", () => {
  test("one cent under the budget still mints — the breaker is not simply always on", async () => {
    const budget = 10;
    const { t, ids } = await seedWorld(modules, {
      monthlyBudgetUsd: budget,
      sessionsPerDay: 5,
    });
    // Topped up to a cent below the ceiling, computed from what is actually
    // there. The other half of the `>=` boundary: if this mints and the exact
    // boundary below refuses, the comparison is `>=` and not `>`.
    const gap = budget - (await monthToDateUsd(t)) - 0.01;
    await t.run(async (ctx) => {
      await ctx.db.insert("spendEvents", { kind: "realtime", usd: gap });
    });
    expect(await monthToDateUsd(t)).toBeCloseTo(budget - 0.01, 6);

    const prepared = await t
      .withIdentity({ subject: STUDENT_DID })
      .mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
    expect(
      prepared.ok,
      `${INV4}: the breaker refused a mint below the monthly budget. A ` +
        "breaker that trips early is an outage with a friendly message.",
    ).toBe(true);
  });

  test("at the monthly budget, a new mint is refused and nothing is created", async () => {
    const budget = 10;
    const { t, ids } = await seedWorld(modules, { monthlyBudgetUsd: budget });
    // Exactly the ceiling, and deliberately computed rather than guessed: the
    // world seeds spend of its own, so a hardcoded top-up makes this a
    // strictly-over test the day that seed changes, and the `>=` boundary
    // stops being covered by anything.
    const gap = budget - (await monthToDateUsd(t));
    await t.run(async (ctx) => {
      await ctx.db.insert("spendEvents", { kind: "realtime", usd: gap });
    });
    expect(
      await monthToDateUsd(t),
      `${INV4}: this test is the only one exercising the breaker's boundary ` +
        "rather than an over-budget deployment; it has to sit exactly on it.",
    ).toBeCloseTo(budget, 6);

    const before = await tally(t);
    const result = await attemptMint(t, ids.assignmentId);

    expect(
      result.ok,
      `${INV4}: the deployment minted a Session past its monthly budget.`,
    ).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe("breaker");
    expectFriendly(result.message, INV4);
    // The Student is told the thing that is actually true for them.
    expect(result.message).toContain("already running is unaffected");
    expect(await tally(t)).toEqual(before);
  });

  test("a tripped breaker does not end, shorten, or touch a live Session", async () => {
    const { t, ids } = await seedWorld(modules, { monthlyBudgetUsd: 10 });
    const liveSessionId = await t.run(async (ctx) => {
      const sessionId = await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "live",
        startedAt: Date.now(),
      });
      await ctx.db.insert("spendEvents", { kind: "realtime", usd: 7 });
      return sessionId;
    });

    const student = t.withIdentity({ subject: STUDENT_DID });
    const refusal = await attemptMint(t, ids.assignmentId);
    expect(refusal.ok).toBe(false);

    const live = await t.run(
      async (ctx) => await ctx.db.get("sessions", liveSessionId),
    );
    expect(
      { status: live?.status, endedAt: live?.endedAt },
      `${INV4} edge (b) BROKEN: tripping the breaker ended a Session that was ` +
        "already running. The breaker is about the next Session, never the " +
        "one a Student is in the middle of.",
    ).toEqual({ status: "live", endedAt: undefined });

    // And the live Session keeps working: its Transcript still accepts turns.
    const upsert = await student.mutation(api.transcript.upsert, {
      sessionId: liveSessionId,
      items: [
        {
          itemId: "mid-breaker",
          orderKey: 1,
          speaker: "student",
          text: "Still speaking while the breaker is tripped.",
          textStatus: "final",
        },
      ],
    });
    expect(
      upsert.accepted,
      `${INV4} edge (b) BROKEN: a tripped breaker stopped a live Session's ` +
        "Transcript from being persisted, which loses the Session's only " +
        "record (ADR-0001).",
    ).toBe(true);
  });

  test("the breaker's module cannot write a Session at all", () => {
    const spendModule = matching(convexSources, [/^convex\/spend\.ts$/]);
    expect(
      Object.keys(spendModule),
      "convex/spend.ts was not found; the breaker moved.",
    ).toHaveLength(1);
    const writes = findAll(
      spendModule,
      /\.(insert|patch|replace|delete)\(\s*"sessions"|scheduler\./,
    );
    expect(
      writes.map(describeHit),
      `${INV4} edge (b) BROKEN: the module that decides the breaker can now ` +
        "write to Sessions or schedule work against them. Nothing in the " +
        "breaker's reach may end a Session — the guarantee is structural, " +
        `not a matter of the current call sites.\n${writes
          .map(describeHit)
          .join("\n")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (3) The forgiveness floor
// ---------------------------------------------------------------------------

describe("INV-4 — a Session under the floor does not burn an attempt", () => {
  test("a Session shorter than minDurationSec ends with countsAgainstCaps false", async () => {
    const { t, ids } = await seedWorld(modules, { minDurationSec: 180 });
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 60_000,
        }),
    );

    const result = await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "disconnected",
    });
    expect(
      result?.countsAgainstCaps,
      `${INV4} edge (a) BROKEN: a Session that ran 60s against a 180s floor ` +
        "burned one of the Student's attempts. A dropped connection is not " +
        "an attempt.",
    ).toBe(false);
    expect(result?.durationSec).toBeCloseTo(60, 0);
  });

  test("a Session that reaches the floor does count", async () => {
    const { t, ids } = await seedWorld(modules, { minDurationSec: 180 });
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 400_000,
        }),
    );
    const result = await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "student_hangup",
    });
    expect(
      result?.countsAgainstCaps,
      `${INV4} edge (a) BROKEN: forgiveness swallowed a full-length Session. ` +
        "The floor forgives a drop, not an attempt.",
    ).toBe(true);
  });

  test("a Session that never connected is forgiven too", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "minted",
        }),
    );
    const result = await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "disconnected",
    });
    expect(result?.countsAgainstCaps).toBe(false);
  });

  test("a forgiven Session does not consume the Student's day cap", async () => {
    const { t, ids } = await seedWorld(modules, { sessionsPerDay: 2 });
    // The world seeds one counting Session. Add a forgiven one: the Student is
    // at 1 of 2, not 2 of 2, and may still mint.
    await t.run(async (ctx) => {
      await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "ended",
        startedAt: Date.now() - 60_000,
        endedAt: Date.now(),
        endReason: "disconnected",
        countsAgainstCaps: false,
      });
    });

    const prepared = await t
      .withIdentity({ subject: STUDENT_DID })
      .mutation(internal.sessions.prepareMint, {
        assignmentId: ids.assignmentId,
      });
    expect(
      prepared.ok,
      `${INV4} edge (a) BROKEN: a Session that was forgiven still consumed ` +
        "one of the Student's attempts.",
    ).toBe(true);
  });

  test("an unfinished Session still counts, so nobody mints without limit by never finishing", async () => {
    const { t, ids } = await seedWorld(modules, { sessionsPerDay: 2 });
    await t.run(async (ctx) => {
      await ctx.db.insert("sessions", {
        studentId: ids.studentId,
        assignmentVersionId: ids.assignmentVersionId,
        status: "live",
        startedAt: Date.now(),
      });
    });
    const result = await attemptMint(t, ids.assignmentId);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (4) All spend counts
// ---------------------------------------------------------------------------

describe("INV-4 — all model spend counts against the monthly budget", () => {
  test("the schema's spend kinds are the ones we think they are", () => {
    expect(
      spendKinds(),
      `${INV4} edge (c): the spend kinds are read from the schema so a kind ` +
        "added later is tested automatically. This assertion only checks the " +
        "two that must always be there.",
    ).toEqual(expect.arrayContaining(["realtime", "grader"]));
  });

  test.each(spendKinds())(
    "%s spend trips the breaker on its own",
    async (kind) => {
      const { t, ids } = await seedWorld(modules, { monthlyBudgetUsd: 1000 });
      await t.run(async (ctx) => {
        await ctx.db.insert("spendEvents", {
          kind,
          usd: 1000,
        });
      });
      const result = await attemptMint(t, ids.assignmentId);
      expect(
        result.ok,
        `${INV4} edge (c) BROKEN: "${kind}" spend does not count against the ` +
          "monthly budget. All model spend counts — realtime, Grader, and " +
          "the guardrail classifier. 'Small enough to ignore' is how a budget " +
          "stops meaning anything.",
      ).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("breaker");
      }
    },
  );

  test("the Grader records its spend through the same ledger the breaker sums", async () => {
    const { t, ids } = await seedWorld(modules, { monthlyBudgetUsd: 100 });
    await t.mutation(internal.spend.record, {
      kind: "grader",
      sessionId: ids.sessionId,
      usd: 200,
    });
    const result = await attemptMint(t, ids.assignmentId);
    expect(result.ok).toBe(false);
  });

  test("a Session cannot end without its realtime spend being accounted for", async () => {
    const { t, ids } = await seedWorld(modules);
    const sessionId = await t.run(
      async (ctx) =>
        await ctx.db.insert("sessions", {
          studentId: ids.studentId,
          assignmentVersionId: ids.assignmentVersionId,
          status: "live",
          startedAt: Date.now() - 400_000,
        }),
    );
    await t.mutation(internal.sessions.finalize, {
      sessionId,
      endReason: "student_hangup",
    });
    const events = await t.run(async (ctx) =>
      (await ctx.db.query("spendEvents").collect()).filter(
        (event) => event.sessionId === sessionId,
      ),
    );
    expect(
      events,
      `${INV4} edge (c) BROKEN: a Session ended without writing a spend ` +
        "event. The write is in the same transaction as the end precisely so " +
        "that it cannot be skipped.",
    ).toHaveLength(1);
    expect(events[0].kind).toBe("realtime");
    expect(events[0].usd).toBeGreaterThan(0);
  });
});
