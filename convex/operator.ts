// ============================================================================
// INV-2 — no research data leaves the deployment boundary.
//
// This is the Operator's entire read surface. Two rules govern it, and the
// invariant suite (convex/tests/inv2-operator-blindness.test.ts) enforces both
// mechanically rather than by review:
//
//   1. Everything an Operator may call returns AGGREGATES ONLY — counts, spend
//      sums, INV-1 flag rates, status and error counts. No Transcript body, no
//      Assessment content, no Student identity. {@link metrics} declares a
//      return validator made of numbers and booleans, which is what makes that
//      checkable: a function that cannot return a string cannot leak prose.
//   2. The ONE exception is the designed break-glass below, and it is not a
//      bypass of the rule — it is a rule of its own. The Operator may read a
//      single Transcript only when the Teacher, who already has read access,
//      has explicitly granted a share for that Session.
//
// Break-glass properties, all of them deliberate (PRD §4 INV-2, "debugging
// path — designed, not improvised"):
//
//   - A share is a TEACHER action. {@link shareTranscriptWithOperator} is
//     Teacher-only; an Operator cannot grant themselves one.
//   - A share is per SESSION. It opens one Transcript, never a second.
//   - A share is PERMANENT. There is deliberately no mutation anywhere in this
//     codebase that deletes or edits a `transcriptShares` row, and none may be
//     added: a share the Teacher could quietly retract would not be a record.
//   - A share is VISIBLE on the Transcript. {@link sharesForSession} is
//     readable by the Teacher, by the Operator, and by the Student whose
//     Session it is — the person whose words were shared is told.
//
// Default is deny: absent a share row, {@link transcriptForSession} throws. It
// does not return an empty Transcript, because an empty Transcript is a thing a
// caller might mistake for "this Session had nothing in it".
// ============================================================================

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getDeploymentConfig } from "./lib/config";
import { requireOperator, requireTeacher, requireUser } from "./lib/identity";
import { breakerBlocksNewMints, monthToDateSpendUsd } from "./spend";

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * The Operator's dashboard, as numbers.
 *
 * Every field is a count, a sum, a rate, or a boolean. That is not a
 * presentation choice — it is INV-2 mechanism (a) expressed in a type. Adding a
 * `v.string()` to this validator would fail the invariant suite, which reads
 * this function's declared return type and rejects any string, bytes, or `any`
 * in it.
 */
const metricsValidator = v.object({
  sessions: v.object({
    total: v.number(),
    minted: v.number(),
    live: v.number(),
    ended: v.number(),
    /** Ended under the forgiveness floor — INV-4 edge (a). */
    forgiven: v.number(),
    endedByStudentHangup: v.number(),
    endedByTimebox: v.number(),
    endedByExaminer: v.number(),
    endedByDisconnect: v.number(),
  }),
  students: v.object({
    active: v.number(),
    voided: v.number(),
  }),
  transcript: v.object({
    /** Rows, not words. A count of turns says nothing about what was said. */
    items: v.number(),
    /** Turns whose ASR never returned. An error rate, not content. */
    failedAsrItems: v.number(),
  }),
  assessments: v.object({
    total: v.number(),
    pending: v.number(),
    /** The Grader's error count: a `failed` Assessment is a run that broke. */
    failed: v.number(),
    complete: v.number(),
    released: v.number(),
  }),
  inv1: v.object({
    /** Complete Assessments carrying at least one Examiner-violation flag. */
    flaggedAssessments: v.number(),
    flags: v.number(),
    /** flaggedAssessments / complete, in [0, 1]. Zero when none are complete. */
    flagRate: v.number(),
  }),
  spend: v.object({
    monthToDateUsd: v.number(),
    monthlyBudgetUsd: v.number(),
    realtimeUsd: v.number(),
    graderUsd: v.number(),
    /** Whether the breaker is currently refusing NEW mints. */
    breakerBlocksNewMints: v.boolean(),
  }),
  breakGlass: v.object({
    /** How many Transcripts a Teacher has opened to the Operator. */
    grantedShares: v.number(),
  }),
});

export type OperatorMetrics = {
  sessions: {
    total: number;
    minted: number;
    live: number;
    ended: number;
    forgiven: number;
    endedByStudentHangup: number;
    endedByTimebox: number;
    endedByExaminer: number;
    endedByDisconnect: number;
  };
  students: { active: number; voided: number };
  transcript: { items: number; failedAsrItems: number };
  assessments: {
    total: number;
    pending: number;
    failed: number;
    complete: number;
    released: number;
  };
  inv1: { flaggedAssessments: number; flags: number; flagRate: number };
  spend: {
    monthToDateUsd: number;
    monthlyBudgetUsd: number;
    realtimeUsd: number;
    graderUsd: number;
    breakerBlocksNewMints: boolean;
  };
  breakGlass: { grantedShares: number };
};

function count<T>(rows: readonly T[], predicate: (row: T) => boolean): number {
  return rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
}

/**
 * Deployment-wide aggregates for the Operator: volume, spend, INV-1 flag rates,
 * and the counts that stand in for error logs.
 *
 * Full-table scans, deliberately. The MVP is one course; an aggregate over a
 * few hundred rows is cheaper to compute than to denormalize, and a counter
 * that drifts from the rows it counts is worse than a slow query.
 *
 * @throws when the caller is not an Operator.
 */
export const metrics = query({
  args: {},
  returns: metricsValidator,
  handler: async (ctx): Promise<OperatorMetrics> => {
    await requireOperator(ctx);
    const config = await getDeploymentConfig(ctx);
    const now = Date.now();

    const sessions = await ctx.db.query("sessions").collect();
    const users = await ctx.db.query("users").collect();
    const items = await ctx.db.query("transcriptItems").collect();
    const assessments = await ctx.db.query("assessments").collect();
    const spendEvents = await ctx.db.query("spendEvents").collect();
    const shares = await ctx.db.query("transcriptShares").collect();

    const students = users.filter((user) => user.role === "student");
    const complete = assessments.filter((row) => row.status === "complete");
    const flagged = complete.filter((row) => (row.inv1Flags ?? []).length > 0);
    const flags = complete.reduce(
      (total, row) => total + (row.inv1Flags ?? []).length,
      0,
    );

    const usdFor = (kind: Doc<"spendEvents">["kind"]): number =>
      spendEvents
        .filter((event) => event.kind === kind)
        .reduce((total, event) => total + event.usd, 0);

    const breaker = await breakerBlocksNewMints(ctx, config, now);

    return {
      sessions: {
        total: sessions.length,
        minted: count(sessions, (s) => s.status === "minted"),
        live: count(sessions, (s) => s.status === "live"),
        ended: count(sessions, (s) => s.status === "ended"),
        forgiven: count(sessions, (s) => s.countsAgainstCaps === false),
        endedByStudentHangup: count(
          sessions,
          (s) => s.endReason === "student_hangup",
        ),
        endedByTimebox: count(sessions, (s) => s.endReason === "timebox"),
        endedByExaminer: count(
          sessions,
          (s) => s.endReason === "examiner_ended",
        ),
        endedByDisconnect: count(
          sessions,
          (s) => s.endReason === "disconnected",
        ),
      },
      students: {
        active: count(students, (s) => s.status === "active"),
        voided: count(students, (s) => s.status === "voided"),
      },
      transcript: {
        items: items.length,
        failedAsrItems: count(items, (item) => item.textStatus === "failed"),
      },
      assessments: {
        total: assessments.length,
        pending: count(assessments, (row) => row.status === "pending"),
        failed: count(assessments, (row) => row.status === "failed"),
        complete: complete.length,
        released: count(assessments, (row) => row.released),
      },
      inv1: {
        flaggedAssessments: flagged.length,
        flags,
        flagRate: complete.length === 0 ? 0 : flagged.length / complete.length,
      },
      spend: {
        monthToDateUsd: await monthToDateSpendUsd(ctx, now),
        monthlyBudgetUsd: config.monthlyBudgetUsd,
        realtimeUsd: usdFor("realtime"),
        graderUsd: usdFor("grader"),
        breakerBlocksNewMints: breaker.tripped,
      },
      breakGlass: { grantedShares: shares.length },
    };
  },
});

// ---------------------------------------------------------------------------
// The break-glass — the Teacher's grant
// ---------------------------------------------------------------------------

const MIN_REASON_LENGTH = 8;

const shareValidator = v.object({
  _id: v.id("transcriptShares"),
  sessionId: v.id("sessions"),
  grantedByTeacherId: v.id("users"),
  grantedAt: v.number(),
  reason: v.string(),
});

export type TranscriptShare = {
  _id: Id<"transcriptShares">;
  sessionId: Id<"sessions">;
  grantedByTeacherId: Id<"users">;
  grantedAt: number;
  reason: string;
};

function projectShare(row: Doc<"transcriptShares">): TranscriptShare {
  return {
    _id: row._id,
    sessionId: row.sessionId,
    grantedByTeacherId: row.grantedByTeacherId,
    grantedAt: row._creationTime,
    reason: row.reason,
  };
}

async function sharesFor(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
): Promise<Doc<"transcriptShares">[]> {
  return await ctx.db
    .query("transcriptShares")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
}

/**
 * Open one Session's Transcript to the Operator. The Teacher's action, and the
 * only way the Operator ever reads a word a Student said.
 *
 * Records who granted it and why. The reason is required and must be a real
 * sentence, because a share with no stated reason is indistinguishable from an
 * accident and this row is the permanent account of a boundary being crossed.
 *
 * Repeat grants for the same Session are appended rather than merged: each is
 * its own dated, reasoned event, and the ledger is the record of all of them.
 *
 * @throws when the caller is not a Teacher, when the Session does not exist, or
 * when the reason is missing or perfunctory.
 */
export const shareTranscriptWithOperator = mutation({
  args: { sessionId: v.id("sessions"), reason: v.string() },
  returns: v.object({ shareId: v.id("transcriptShares") }),
  handler: async (ctx, args) => {
    const teacher = await requireTeacher(ctx);
    const session = await ctx.db.get("sessions", args.sessionId);
    if (session === null) {
      throw new Error("No such Session.");
    }
    const reason = args.reason.trim();
    if (reason.length < MIN_REASON_LENGTH) {
      throw new Error(
        "A transcript share needs a stated reason: this row is the permanent " +
          "record of the Operator being shown one Student's words.",
      );
    }
    const shareId = await ctx.db.insert("transcriptShares", {
      sessionId: args.sessionId,
      grantedByTeacherId: teacher._id,
      reason,
    });
    return { shareId };
  },
});

/**
 * The share ledger for one Session — the "permanently visible on the
 * transcript" half of INV-2's break-glass.
 *
 * Readable by the Teacher, by the Operator, and by the Student whose Session it
 * is. The Student is deliberately included: the point of a visible share is
 * that the person whose words were handed over can see that it happened, who
 * did it, and why.
 *
 * An empty array means no share was ever granted, which is the steady state.
 *
 * @throws when the caller is a Student other than the one this Session belongs
 * to, or is not signed in at all.
 */
export const sharesForSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.array(shareValidator),
  handler: async (ctx, args): Promise<TranscriptShare[]> => {
    const caller = await requireUser(ctx);
    if (caller.role === "student") {
      const session = await ctx.db.get("sessions", args.sessionId);
      if (session === null || session.studentId !== caller._id) {
        throw new Error("Forbidden: that Session does not belong to you.");
      }
    }
    const rows = await sharesFor(ctx, args.sessionId);
    return rows.map(projectShare);
  },
});

// ---------------------------------------------------------------------------
// The break-glass — the Operator's read
// ---------------------------------------------------------------------------

const transcriptRowValidator = v.object({
  itemId: v.string(),
  orderKey: v.number(),
  speaker: v.union(v.literal("student"), v.literal("examiner")),
  text: v.string(),
  textStatus: v.union(
    v.literal("final"),
    v.literal("failed"),
    v.literal("truncated"),
  ),
});

export type BreakGlassTranscript = {
  items: {
    itemId: string;
    orderKey: number;
    speaker: Doc<"transcriptItems">["speaker"];
    text: string;
    textStatus: Doc<"transcriptItems">["textStatus"];
  }[];
  shares: TranscriptShare[];
};

/**
 * The single Operator function that returns Transcript content, and the only
 * one that ever may.
 *
 * It is gated on a `transcriptShares` row for this exact Session. No row, no
 * read — and the refusal is a thrown error, not an empty result, because an
 * Operator must never be able to mistake "you were not granted this" for "there
 * was nothing here".
 *
 * The share ledger is returned alongside the Transcript on purpose: an Operator
 * reading a Student's words sees, in the same breath, who authorised it and
 * why.
 *
 * @throws when the caller is not an Operator, or when no Teacher has shared
 * this Session's Transcript.
 */
export const transcriptForSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    items: v.array(transcriptRowValidator),
    shares: v.array(shareValidator),
  }),
  handler: async (ctx, args): Promise<BreakGlassTranscript> => {
    await requireOperator(ctx);
    const shares = await sharesFor(ctx, args.sessionId);
    if (shares.length === 0) {
      throw new Error(
        "Forbidden (INV-2): the Operator has no read access to Transcript " +
          "content. A Teacher must share this Session's Transcript before it " +
          "can be read, and the share is recorded on the Transcript.",
      );
    }
    const items = await ctx.db
      .query("transcriptItems")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    return {
      items: items.map((item) => ({
        itemId: item.itemId,
        orderKey: item.orderKey,
        speaker: item.speaker,
        text: item.text,
        textStatus: item.textStatus,
      })),
      shares: shares.map(projectShare),
    };
  },
});
