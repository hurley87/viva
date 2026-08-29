// The Session lifecycle: mint, start, finalize, and the Student-scoped reads
// the app renders from.
//
// INV-3 (PRD §4): this module is the mint path, so it reads `assignments` and
// `assignmentVersions` only. It holds no import of, and no reference to, the
// Grader-only island the post-Session evaluation reads.
//
// The shape of a Session's life, and the contract the rest of the build is
// written against:
//
//   mintSession (action)
//     -> prepareMint (mutation): breaker, then caps, then pin, then schedule.
//        A refusal returns a message and creates NOTHING.
//     -> a short-lived OpenAI client secret carrying the assembled Examiner
//        instructions. The browser gets the secret; never the instructions.
//   start (mutation)
//     the browser reports the WebRTC call id once the SDP exchange resolves.
//     `startedAt` is stamped here, on the SERVER clock, and the accurate
//     time-box job is scheduled from it.
//   finalize (internal mutation, idempotent)
//     stamps `endedAt`/`endReason`, applies the forgiveness floor to
//     `countsAgainstCaps`, records the realtime spend, and — with no human
//     action — opens the pending Assessment and schedules the Grader.
//   enforceTimebox (internal action, convex/examiner/realtime.ts)
//     the enforcement path: hang the call up and finalize. The client
//     countdown is UX; this is what actually stops a Session at the box.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { assignmentForVersion, highestPublishedVersion } from "./assignments";
import { createPendingAssessment } from "./assessments";
import { buildExaminerInstructions } from "./examiner/instructions";
import { getDeploymentConfig } from "./lib/config";
import { CONNECT_GRACE_SEC } from "./lib/constants";
import { requireStudent } from "./lib/identity";
import {
  countsAgainstCaps,
  durationSec,
  timeboxCutoffAt,
} from "./lib/time";
import {
  breakerBlocksNewMints,
  realtimeSpendUsd,
  recordSpendEvent,
  sessionCapCounts,
} from "./spend";

const MS_PER_SEC = 1000;

// ---------------------------------------------------------------------------
// Validators and types
// ---------------------------------------------------------------------------

const sessionStatus = v.union(
  v.literal("minted"),
  v.literal("live"),
  v.literal("ended"),
);

const endReasonValidator = v.union(
  v.literal("student_hangup"),
  v.literal("timebox"),
  v.literal("examiner_ended"),
  v.literal("disconnected"),
);

export type EndReason = Doc<"sessions">["endReason"] & string;

/**
 * The three reasons the Examiner's `end_session` tool may report, plus the
 * transport-level `disconnected` the browser reports when the call drops.
 * These are the client's vocabulary; {@link END_REASON_FROM_TOOL} translates
 * them into the Session's own.
 */
const clientEndReason = v.union(
  v.literal("timebox"),
  v.literal("dead_threads"),
  v.literal("student_request"),
  v.literal("disconnected"),
);

/** Approved prototype §2 reasons -> the schema's `endReason`. */
const END_REASON_FROM_TOOL = {
  timebox: "timebox",
  dead_threads: "examiner_ended",
  student_request: "student_hangup",
  disconnected: "disconnected",
} as const satisfies Record<string, EndReason>;

/** Why a mint was refused. Refusals are returned, never thrown (build brief). */
const refusalReason = v.union(
  v.literal("breaker"),
  v.literal("day_cap"),
  v.literal("week_cap"),
);

type RefusalReason = "breaker" | "day_cap" | "week_cap";

export type MintRefusal = {
  ok: false;
  reason: RefusalReason;
  message: string;
};

const refusalValidator = v.object({
  ok: v.literal(false),
  reason: refusalReason,
  message: v.string(),
});

type PrepareSuccess = {
  ok: true;
  sessionId: Id<"sessions">;
  instructions: string;
  timeboxSec: number;
  warningAtSec: number;
};

type PrepareResult = MintRefusal | PrepareSuccess;

export type MintSuccess = {
  ok: true;
  sessionId: Id<"sessions">;
  clientSecret: string;
  timeboxSec: number;
  warningAtSec: number;
};

export type MintResult = MintRefusal | MintSuccess;

type FinalizeResult = {
  alreadyEnded: boolean;
  endReason: EndReason;
  endedAt: number;
  durationSec: number;
  countsAgainstCaps: boolean;
};

const finalizeResultValidator = v.object({
  alreadyEnded: v.boolean(),
  endReason: endReasonValidator,
  endedAt: v.number(),
  durationSec: v.number(),
  countsAgainstCaps: v.boolean(),
});

// ---------------------------------------------------------------------------
// Friendly refusals (PRD §4 INV-4 done-means: "cap-exceeded mint request
// returns friendly refusal"). These are text a Student reads while wanting to
// work, so they say what happened and when it clears — never an error code.
// ---------------------------------------------------------------------------

function dayCapMessage(perDay: number): string {
  const attempts = perDay === 1 ? "Session" : "Sessions";
  return (
    `You have used your ${perDay} ${attempts} for today. Another becomes ` +
    "available 24 hours after the first of them. Sessions shorter than a few " +
    "minutes do not count, so a dropped connection has not cost you one."
  );
}

function weekCapMessage(perWeek: number): string {
  return (
    `You have used all ${perWeek} of your Sessions for this week. More become ` +
    "available as the earliest ones pass out of the seven-day window."
  );
}

const BREAKER_MESSAGE =
  "Viva is not starting new Sessions right now: this deployment has reached " +
  "its spend limit for the month. Any Session already running is unaffected. " +
  "Tell your Teacher — they can raise the limit.";

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

/**
 * The caller's own Session.
 *
 * @throws when the caller is not a Student, the Session does not exist, or it
 * belongs to somebody else. Authorization failures throw; only cap and breaker
 * decisions are returned values.
 */
async function requireOwnSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
): Promise<{ student: Doc<"users">; session: Doc<"sessions"> }> {
  const student = await requireStudent(ctx);
  const session = await ctx.db.get("sessions", sessionId);
  if (session === null || session.studentId !== student._id) {
    // Deliberately one message for both cases: a Student may not learn
    // whether somebody else's Session id exists.
    throw new Error("Forbidden: that Session does not belong to you.");
  }
  return { student, session };
}

// ---------------------------------------------------------------------------
// 1. Mint
// ---------------------------------------------------------------------------

/**
 * The INV-4 gate, run in one transaction, in this order:
 *
 *   1. breaker — the deployment's month-to-date spend against its budget.
 *   2. caps    — this Student's Sessions in the rolling day and week windows.
 *   3. pin     — the highest published Assignment version. A Session stores
 *                `assignmentVersionId`, never `assignmentId`, so a later
 *                publication can never change what this Session was examined
 *                against.
 *   4. schedule — the mint-time time-box backstop, which covers a client that
 *                never completes the WebRTC connection.
 *
 * A refusal returns before any write: no Session row, no scheduled job, no
 * spend, and — because the action checks `ok` before going near OpenAI — no
 * client secret.
 */
export const prepareMint = internalMutation({
  args: { assignmentId: v.id("assignments") },
  returns: v.union(
    refusalValidator,
    v.object({
      ok: v.literal(true),
      sessionId: v.id("sessions"),
      instructions: v.string(),
      timeboxSec: v.number(),
      warningAtSec: v.number(),
    }),
  ),
  handler: async (ctx, args): Promise<PrepareResult> => {
    const student = await requireStudent(ctx);
    const config = await getDeploymentConfig(ctx);
    const now = Date.now();

    // 1. Breaker. Mints only — nothing here can touch a live Session.
    const breaker = await breakerBlocksNewMints(ctx, config, now);
    if (breaker.tripped) {
      return { ok: false, reason: "breaker", message: BREAKER_MESSAGE };
    }

    // 2. Caps. Unfinished Sessions count: `countsAgainstCaps` is undefined
    // until finalize, and only an explicit `false` forgives.
    const counts = await sessionCapCounts(ctx, student._id, now);
    if (counts.day >= config.sessionsPerDay) {
      return {
        ok: false,
        reason: "day_cap",
        message: dayCapMessage(config.sessionsPerDay),
      };
    }
    if (counts.week >= config.sessionsPerWeek) {
      return {
        ok: false,
        reason: "week_cap",
        message: weekCapMessage(config.sessionsPerWeek),
      };
    }

    // 3. Pin.
    const version = await highestPublishedVersion(ctx, args.assignmentId);
    if (version === null) {
      // Not a friendly refusal: a Student cannot fix an unpublished
      // Assignment, and pretending they can be patient about it would be a
      // lie. This is a broken deployment.
      throw new Error(
        "This Assignment has no published version, so there is nothing to " +
          "examine against.",
      );
    }
    const instructions = buildExaminerInstructions(version.prompt);

    const sessionId = await ctx.db.insert("sessions", {
      studentId: student._id,
      assignmentVersionId: version._id,
      status: "minted",
    });

    // 4. Schedule the backstop. `sessions.start` schedules the accurate job
    // from the real start; this one exists for the Session that never
    // connects, and no-ops if the accurate job got there first.
    await ctx.scheduler.runAfter(
      (config.timeboxSec + CONNECT_GRACE_SEC) * MS_PER_SEC,
      internal.examiner.realtime.enforceTimebox,
      { sessionId },
    );

    return {
      ok: true,
      sessionId,
      instructions,
      timeboxSec: config.timeboxSec,
      warningAtSec: config.warningAtSec,
    };
  },
});

/**
 * Mint a Session: run the INV-4 gate, then buy the browser a short-lived
 * ticket to the Examiner.
 *
 * The Examiner instructions never leave the server. They are assembled inside
 * `prepareMint`, handed to the client-secret call, and dropped; what comes
 * back to the browser is an `ek_...` secret (INV-1 mechanism a).
 *
 * If the client-secret call fails the Session row survives as `minted`. That
 * is intentional: the time-box backstop finalizes it with a zero duration,
 * which the forgiveness floor marks as not counting against the caps, so a
 * failed mint costs the Student nothing.
 */
export const mintSession = action({
  args: { assignmentId: v.id("assignments") },
  returns: v.union(
    refusalValidator,
    v.object({
      ok: v.literal(true),
      sessionId: v.id("sessions"),
      clientSecret: v.string(),
      timeboxSec: v.number(),
      warningAtSec: v.number(),
    }),
  ),
  handler: async (ctx, args): Promise<MintResult> => {
    const prepared: PrepareResult = await ctx.runMutation(
      internal.sessions.prepareMint,
      { assignmentId: args.assignmentId },
    );
    if (!prepared.ok) {
      return prepared;
    }

    // Crossing into the Node runtime, where the OpenAI SDK lives. This module
    // stays in the isolate because it also holds mutations and queries, and a
    // `"use node"` file may contain only actions.
    const secret: { clientSecret: string; expiresAt: number } =
      await ctx.runAction(internal.examiner.realtime.createClientSecret, {
        instructions: prepared.instructions,
      });

    return {
      ok: true,
      sessionId: prepared.sessionId,
      clientSecret: secret.clientSecret,
      timeboxSec: prepared.timeboxSec,
      warningAtSec: prepared.warningAtSec,
    };
  },
});

// ---------------------------------------------------------------------------
// 2. Start
// ---------------------------------------------------------------------------

/**
 * The browser reports the WebRTC call id once the SDP exchange resolves, and
 * the Session goes live.
 *
 * `startedAt` is the server's clock, not the browser's: everything downstream
 * — the time-box, the forgiveness floor, the refusal to persist late material
 * — is measured from a number the client cannot influence. The call id is the
 * one thing only the client knows, and it is what the scheduled hangup posts
 * to.
 *
 * @throws if the Session is not freshly minted. A second `start` cannot extend
 * a Session by re-stamping its start time.
 */
export const start = mutation({
  args: {
    sessionId: v.id("sessions"),
    // Optional because the SDK can, in principle, complete a connection
    // without surfacing the call id. A Session with no call id still has a
    // server-stamped start and a scheduled time-box; it just loses the
    // server-side hangup and is stopped by finalize alone.
    openaiCallId: v.optional(v.string()),
  },
  returns: v.object({
    startedAt: v.number(),
    endsAt: v.number(),
    timeboxSec: v.number(),
    warningAtSec: v.number(),
  }),
  handler: async (ctx, args) => {
    const { session } = await requireOwnSession(ctx, args.sessionId);
    if (session.status !== "minted") {
      throw new Error(
        `This Session is already ${session.status}; it cannot be started again.`,
      );
    }
    const config = await getDeploymentConfig(ctx);
    const startedAt = Date.now();

    await ctx.db.patch("sessions", session._id, {
      status: "live",
      startedAt,
      ...(args.openaiCallId === undefined
        ? {}
        : { openaiCallId: args.openaiCallId }),
    });

    // The accurate time-box job, scheduled from the real start. The mint-time
    // backstop is left in place: it is idempotent, and it checks the cutoff
    // before acting, so a late-connecting Session is not cut short by it.
    await ctx.scheduler.runAfter(
      config.timeboxSec * MS_PER_SEC,
      internal.examiner.realtime.enforceTimebox,
      { sessionId: session._id },
    );

    return {
      startedAt,
      endsAt: startedAt + config.timeboxSec * MS_PER_SEC,
      timeboxSec: config.timeboxSec,
      warningAtSec: config.warningAtSec,
    };
  },
});

// ---------------------------------------------------------------------------
// 3. Finalize
// ---------------------------------------------------------------------------

/**
 * End a Session once, whatever ended it.
 *
 * Idempotent by construction: a Session that is already `ended` is returned
 * untouched, with the reason it actually ended for. Both the graceful path
 * (the Examiner's `end_session` tool) and the enforcement path (the scheduled
 * hangup) land here, and they race by design.
 */
async function finalizeSession(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  endReason: EndReason,
): Promise<FinalizeResult> {
  const config = await getDeploymentConfig(ctx);

  if (session.status === "ended") {
    const endedAt = session.endedAt ?? session._creationTime;
    return {
      alreadyEnded: true,
      endReason: session.endReason ?? endReason,
      endedAt,
      durationSec: durationSec(session.startedAt, endedAt),
      countsAgainstCaps: session.countsAgainstCaps ?? false,
    };
  }

  const endedAt = Date.now();
  const ranForSec = durationSec(session.startedAt, endedAt);
  const counts = countsAgainstCaps(ranForSec, config.minDurationSec);

  await ctx.db.patch("sessions", session._id, {
    status: "ended",
    endedAt,
    endReason,
    countsAgainstCaps: counts,
  });

  // INV-4 edge (c): all model spend counts. Written in the same transaction
  // as the end, so a Session cannot end without being accounted for.
  await recordSpendEvent(ctx, {
    kind: "realtime",
    sessionId: session._id,
    usd: realtimeSpendUsd(ranForSec),
  });

  // Grading. The Session just transitioned to `ended` — the `alreadyEnded`
  // branch above returns before this point — so this runs exactly once per
  // Session, with no human action anywhere in the path.
  //
  // Except for a Session with no Transcript at all. That is the Session that
  // was minted and never connected: the time-box backstop finalizes it as
  // `disconnected` with a zero duration, and there is nothing whatsoever to
  // evaluate. Creating an Assessment for it would mean either a junk row of
  // `not_probed` ratings against criteria the Student never heard a single
  // question from, or a permanently `failed` Assessment on every drop —
  // both of which teach a Teacher to ignore the column. So it gets none, and
  // `assessments.retry` is the repair path if a Transcript ever turns up.
  //
  // `first()` on the ordered index is one indexed read; this is the end of a
  // Session, not a hot path.
  const anyTranscript = await ctx.db
    .query("transcriptItems")
    .withIndex("by_session_order", (q) => q.eq("sessionId", session._id))
    .first();
  if (anyTranscript !== null) {
    await createPendingAssessment(ctx, session._id, config.releaseMode);
  }

  return {
    alreadyEnded: false,
    endReason,
    endedAt,
    durationSec: ranForSec,
    countsAgainstCaps: counts,
  };
}

/**
 * End a Session from the server: the scheduled time-box job's landing point.
 * Safe to call on an already-ended Session.
 */
export const finalize = internalMutation({
  args: { sessionId: v.id("sessions"), endReason: endReasonValidator },
  returns: v.union(v.null(), finalizeResultValidator),
  handler: async (ctx, args): Promise<FinalizeResult | null> => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (session === null) {
      return null;
    }
    return await finalizeSession(ctx, session, args.endReason);
  },
});

/**
 * End a Session from the browser: the Examiner's `end_session` tool, the
 * Student's own "End Session" control, or a dropped transport.
 *
 * The reported reason decides only the label on a Session that is ending
 * anyway. It cannot extend one, and it cannot resurrect one — the enforcement
 * path is the scheduled hangup, not this.
 */
export const end = mutation({
  args: { sessionId: v.id("sessions"), reason: clientEndReason },
  returns: finalizeResultValidator,
  handler: async (ctx, args): Promise<FinalizeResult> => {
    const { session } = await requireOwnSession(ctx, args.sessionId);
    return await finalizeSession(
      ctx,
      session,
      END_REASON_FROM_TOOL[args.reason],
    );
  },
});

// ---------------------------------------------------------------------------
// 4. Time-box state (read by the enforcement action)
// ---------------------------------------------------------------------------

type TimeboxState = {
  status: Doc<"sessions">["status"];
  startedAt: number | null;
  openaiCallId: string | null;
  cutoffAt: number;
  dueNow: boolean;
  msUntilCutoff: number;
};

/**
 * What the time-box job needs in order to decide whether to act.
 *
 * `cutoffAt` is computed here, on the server clock, from the Session's own
 * timestamps — never from which timer happened to fire:
 *
 *   - a live Session is due at `startedAt + timeboxSec`;
 *   - a Session that never connected is due at
 *     `mintedAt + timeboxSec + CONNECT_GRACE_SEC`, the point past which no
 *     client is going to turn up.
 *
 * That is what makes both scheduled jobs safe to fire. The mint-time backstop
 * runs at a fixed offset from the mint, so for a Session that connected late
 * it arrives early; it sees `dueNow: false` and re-arms rather than cutting a
 * Student short.
 */
export const timeboxState = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      status: sessionStatus,
      startedAt: v.union(v.number(), v.null()),
      openaiCallId: v.union(v.string(), v.null()),
      cutoffAt: v.number(),
      dueNow: v.boolean(),
      msUntilCutoff: v.number(),
    }),
  ),
  handler: async (ctx, args): Promise<TimeboxState | null> => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (session === null) {
      return null;
    }
    const config = await getDeploymentConfig(ctx);
    const cutoffAt =
      timeboxCutoffAt(session.startedAt, config.timeboxSec) ??
      session._creationTime +
        (config.timeboxSec + CONNECT_GRACE_SEC) * MS_PER_SEC;
    const now = Date.now();
    return {
      status: session.status,
      startedAt: session.startedAt ?? null,
      openaiCallId: session.openaiCallId ?? null,
      cutoffAt,
      dueNow: now >= cutoffAt,
      msUntilCutoff: cutoffAt - now,
    };
  },
});

// ---------------------------------------------------------------------------
// 5. Grader-facing read
// ---------------------------------------------------------------------------

type GraderSessionContext = {
  assignmentVersionId: Id<"assignmentVersions">;
  assignmentTitle: string;
  assignmentPrompt: string;
  status: Doc<"sessions">["status"];
  endedAt: number | null;
};

/**
 * The Session context the post-hoc Grader needs: which Assignment the Student
 * was answering, and whether the Session is actually over.
 *
 * Internal, and read-only. The Grader runs after the fact, in a different
 * model with a different context; nothing it can call from here touches a live
 * Session, and this query holds no reference to the Grader-only island that
 * stores what a competent response must demonstrate (INV-3).
 */
export const forGrader = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      assignmentVersionId: v.id("assignmentVersions"),
      assignmentTitle: v.string(),
      assignmentPrompt: v.string(),
      status: sessionStatus,
      endedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args): Promise<GraderSessionContext | null> => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (session === null) {
      return null;
    }
    const pinned = await assignmentForVersion(ctx, session.assignmentVersionId);
    return {
      // The pin itself. The post-hoc evaluation is done against the version
      // this Session was examined against, never the latest one.
      assignmentVersionId: session.assignmentVersionId,
      assignmentTitle: pinned?.title ?? "Assignment",
      assignmentPrompt: pinned?.version.prompt ?? "",
      status: session.status,
      endedAt: session.endedAt ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// 6. Student-scoped reads
// ---------------------------------------------------------------------------

const studentSessionValidator = v.object({
  _id: v.id("sessions"),
  createdAt: v.number(),
  status: sessionStatus,
  startedAt: v.union(v.number(), v.null()),
  endedAt: v.union(v.number(), v.null()),
  endReason: v.union(endReasonValidator, v.null()),
  countsAgainstCaps: v.union(v.boolean(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  assignmentTitle: v.string(),
  assignmentVersion: v.number(),
});

type StudentSession = {
  _id: Id<"sessions">;
  createdAt: number;
  status: Doc<"sessions">["status"];
  startedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  countsAgainstCaps: boolean | null;
  durationSec: number | null;
  assignmentTitle: string;
  assignmentVersion: number;
};

async function projectStudentSession(
  ctx: QueryCtx,
  session: Doc<"sessions">,
): Promise<StudentSession> {
  const pinned = await assignmentForVersion(ctx, session.assignmentVersionId);
  return {
    _id: session._id,
    createdAt: session._creationTime,
    status: session.status,
    startedAt: session.startedAt ?? null,
    endedAt: session.endedAt ?? null,
    endReason: session.endReason ?? null,
    countsAgainstCaps: session.countsAgainstCaps ?? null,
    durationSec:
      session.endedAt === undefined
        ? null
        : durationSec(session.startedAt, session.endedAt),
    assignmentTitle: pinned?.title ?? "Assignment",
    assignmentVersion: pinned?.version.version ?? 0,
  };
}

/** The caller's own Sessions, newest first. Never anybody else's. */
export const mine = query({
  args: {},
  returns: v.array(studentSessionValidator),
  handler: async (ctx): Promise<StudentSession[]> => {
    const student = await requireStudent(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .order("desc")
      .take(50);
    const rows: StudentSession[] = [];
    for (const session of sessions) {
      rows.push(await projectStudentSession(ctx, session));
    }
    return rows;
  },
});

/**
 * One of the caller's own Sessions, with everything the live Session screen
 * renders: the pinned Assignment, the time-box, and the current state.
 *
 * The Examiner's instructions are not here and never will be (INV-1
 * mechanism a).
 */
export const getForStudent = query({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    session: studentSessionValidator,
    assignmentPrompt: v.string(),
    timeboxSec: v.number(),
    warningAtSec: v.number(),
    minDurationSec: v.number(),
  }),
  handler: async (ctx, args) => {
    const { session } = await requireOwnSession(ctx, args.sessionId);
    const config = await getDeploymentConfig(ctx);
    const pinned = await assignmentForVersion(ctx, session.assignmentVersionId);
    return {
      session: await projectStudentSession(ctx, session),
      assignmentPrompt: pinned?.version.prompt ?? "",
      timeboxSec: config.timeboxSec,
      warningAtSec: config.warningAtSec,
      minDurationSec: config.minDurationSec,
    };
  },
});
