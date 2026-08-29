// Assessment reads, the Grader's writes, and the shadow-period release.
//
// One Assessment per Session, created `pending` by `sessions.sealSession` once
// the Session's Transcript write window has closed, and filled in by the Grader
// minutes later. This module is the isolate-runtime half of that:
// `convex/grader/run.ts` is a `"use node"` file and so may contain only
// actions, which have no `ctx.db`. Every database touch the Grader needs lands
// here.
//
// Release (PRD §8). `released` is a property of the Assessment, decided once,
// at creation, from `deploymentConfig.releaseMode`:
//
//   - "auto"   — the steady state. The formative summary reaches the Student
//                within minutes of the Session, while the defense is warm. No
//                Teacher gate; the loop's tempo must not depend on one busy
//                person.
//   - "shadow" — the cold-start exception. A deployment's first real Sessions
//                release to the Teacher only, until the Teacher has spot-checked
//                Grader quality. {@link release} is the Teacher's action.
//
// The gate exists once, at the start of a deployment, never per-Assessment: a
// deployment leaves the shadow period by flipping `releaseMode` to "auto", not
// by the Teacher settling into a habit of releasing each one.
//
// Who sees what (PRD §8): the Teacher sees everything — per-Criterion ratings,
// evidence, the INV-1 audit. The Student sees the formative summary and their
// own Transcript, and only once released. {@link forStudent} is the projection
// that makes that structural rather than a matter of which fields a page
// happens to render.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getDeploymentConfig } from "./lib/config";
import { GRADER_STALL_SEC } from "./lib/constants";
import { requireStudent, requireTeacher } from "./lib/identity";

const MS_PER_SEC = 1000;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const assessmentStatus = v.union(
  v.literal("pending"),
  v.literal("complete"),
  v.literal("failed"),
);

// Mirrors `convex/grader/assessmentSchema.ts`, which carries a compile-time
// assertion that its Zod types and this table's types are the same types. If
// these two drift, `npm run typecheck` fails there.
const criterionRating = v.union(
  v.literal("established"),
  v.literal("partially_established"),
  v.literal("not_established"),
  v.literal("not_probed"),
);

const assessedCriterion = v.object({
  name: v.string(),
  rating: criterionRating,
  evidence: v.array(v.string()),
});

const inv1Flag = v.object({
  quote: v.string(),
  explanation: v.string(),
});

/** The whole Assessment. Teacher-only — never projected to a Student. */
const teacherAssessmentValidator = v.object({
  _id: v.id("assessments"),
  sessionId: v.id("sessions"),
  status: assessmentStatus,
  criteria: v.union(v.array(assessedCriterion), v.null()),
  formativeSummary: v.union(v.string(), v.null()),
  inv1Flags: v.union(v.array(inv1Flag), v.null()),
  graderModel: v.union(v.string(), v.null()),
  released: v.boolean(),
  releasedAt: v.union(v.number(), v.null()),
});

export type AssessmentStatus = Doc<"assessments">["status"];

export type TeacherAssessment = {
  _id: Id<"assessments">;
  sessionId: Id<"sessions">;
  status: AssessmentStatus;
  criteria: NonNullable<Doc<"assessments">["criteria"]> | null;
  formativeSummary: string | null;
  inv1Flags: NonNullable<Doc<"assessments">["inv1Flags"]> | null;
  graderModel: string | null;
  released: boolean;
  releasedAt: number | null;
};

/** What a Student may see: the formative summary, and only once released. */
const studentAssessmentValidator = v.object({
  status: assessmentStatus,
  released: v.boolean(),
  formativeSummary: v.union(v.string(), v.null()),
});

export type StudentAssessment = {
  status: AssessmentStatus;
  released: boolean;
  formativeSummary: string | null;
};

// ---------------------------------------------------------------------------
// Shared reads
// ---------------------------------------------------------------------------

async function assessmentForSession(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<"sessions">,
): Promise<Doc<"assessments"> | null> {
  return await ctx.db
    .query("assessments")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .unique();
}

function projectForTeacher(row: Doc<"assessments">): TeacherAssessment {
  return {
    _id: row._id,
    sessionId: row.sessionId,
    status: row.status,
    criteria: row.criteria ?? null,
    formativeSummary: row.formativeSummary ?? null,
    inv1Flags: row.inv1Flags ?? null,
    graderModel: row.graderModel ?? null,
    released: row.released,
    releasedAt: row.releasedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Creation and scheduling — called by `sessions.sealSession` and by `retry`
// ---------------------------------------------------------------------------

/**
 * Create the `pending` Assessment for a Session and put the Grader to work.
 *
 * Two jobs are scheduled, and the second one is the interesting one. A
 * scheduled ACTION runs at most once and is never retried, so a dropped
 * `gradeSession` would leave an Assessment `pending` forever with nothing to
 * notice it. A scheduled MUTATION runs exactly once. {@link failIfStillPending}
 * is that mutation: it fires well after any real Grader run would have
 * finished, and turns a silently-dropped run into a visible `failed` — which is
 * retryable, where an eternal `pending` is not.
 *
 * Shared by the Session-seal seam and by {@link retry} so that both paths
 * schedule the same pair of jobs and neither can forget the sweep.
 */
export async function createPendingAssessment(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  releaseMode: Doc<"deploymentConfig">["releaseMode"],
): Promise<Id<"assessments">> {
  const assessmentId = await ctx.db.insert("assessments", {
    sessionId,
    status: "pending",
    // Decided once, here. PRD §8: the shadow period is a deployment-level
    // cold start, not a per-Assessment review gate.
    released: releaseMode === "auto",
  });
  await scheduleGrader(ctx, sessionId, assessmentId);
  return assessmentId;
}

/**
 * Schedule the Grader run and its stall sweep.
 *
 * The run is given an identity — `graderRunAt`, the instant it was scheduled —
 * and the sweep carries the same number. Without it the sweep is scoped to the
 * Assessment rather than to the run, and the sequence "run fails, Teacher
 * retries, the *first* run's sweep comes due" marks the Teacher's fresh run
 * `failed` seconds after it started, for a stall that belonged to a run that is
 * already over.
 */
export async function scheduleGrader(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  assessmentId: Id<"assessments">,
): Promise<void> {
  const graderRunAt = Date.now();
  await ctx.db.patch("assessments", assessmentId, { graderRunAt });
  await ctx.scheduler.runAfter(0, internal.grader.run.gradeSession, {
    sessionId,
  });
  await ctx.scheduler.runAfter(
    GRADER_STALL_SEC * MS_PER_SEC,
    internal.assessments.failIfStillPending,
    { assessmentId, graderRunAt },
  );
}

// ---------------------------------------------------------------------------
// The Grader's own reads and writes
// ---------------------------------------------------------------------------

/**
 * What the Grader action needs before it starts: which Assessment it is
 * filling in, what state it is in, and the pinned Assignment version whose
 * Standard it will be evaluated against.
 *
 * Returns `null` when the Session has no Assessment at all — the seal seam
 * deliberately creates none for a Session with no Transcript, and the Grader
 * must not conjure one.
 */
export const forGraderRun = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      assessmentId: v.id("assessments"),
      status: assessmentStatus,
    }),
  ),
  handler: async (ctx, args) => {
    const assessment = await assessmentForSession(ctx, args.sessionId);
    if (assessment === null) {
      return null;
    }
    return { assessmentId: assessment._id, status: assessment.status };
  },
});

/**
 * Write the finished Assessment.
 *
 * `released` is deliberately not touched: it was decided when the row was
 * created, and a re-run of the Grader must not quietly un-release an
 * Assessment a Teacher has already released.
 */
export const recordComplete = internalMutation({
  args: {
    assessmentId: v.id("assessments"),
    criteria: v.array(assessedCriterion),
    formativeSummary: v.string(),
    inv1Flags: v.array(inv1Flag),
    graderModel: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch("assessments", args.assessmentId, {
      status: "complete",
      criteria: args.criteria,
      formativeSummary: args.formativeSummary,
      inv1Flags: args.inv1Flags,
      graderModel: args.graderModel,
    });
    return null;
  },
});

/**
 * Record that the Grader could not produce an Assessment.
 *
 * `failed` is a resting state, not a dead end: {@link retry} runs the Grader
 * again against the same Transcript. The reason lives in the Convex function
 * logs rather than on the row — the approved schema has no field for it, and
 * the Teacher's recourse is the same whatever it says.
 *
 * A `complete` Assessment is never downgraded: a late-arriving failure from a
 * duplicate run must not erase a good result.
 */
export const recordFailed = internalMutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const assessment = await ctx.db.get("assessments", args.assessmentId);
    if (assessment === null || assessment.status === "complete") {
      return null;
    }
    await ctx.db.patch("assessments", args.assessmentId, { status: "failed" });
    return null;
  },
});

/**
 * The stall sweep. Scheduled alongside every Grader run as an exactly-once
 * mutation, so a Grader action that was dropped rather than executed still ends
 * up somewhere a human can see and retry from.
 *
 * Scoped to one run, not to the Assessment: it acts only while `graderRunAt`
 * still names the run it was scheduled for. A sweep left over from a run that
 * has since been retried is about a stall that is already resolved, and marking
 * the retry `failed` on its account would be a lie a Teacher then has to chase.
 */
export const failIfStillPending = internalMutation({
  args: { assessmentId: v.id("assessments"), graderRunAt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const assessment = await ctx.db.get("assessments", args.assessmentId);
    if (assessment === null || assessment.status !== "pending") {
      return false;
    }
    if (assessment.graderRunAt !== args.graderRunAt) {
      // A newer run owns this Assessment; its own sweep is the one that counts.
      return false;
    }
    console.error(
      `Assessment ${args.assessmentId} was still pending ${GRADER_STALL_SEC}s ` +
        `after the Grader was scheduled. Marking it failed so it can be retried.`,
    );
    await ctx.db.patch("assessments", args.assessmentId, { status: "failed" });
    return true;
  },
});

// ---------------------------------------------------------------------------
// Teacher surface
// ---------------------------------------------------------------------------

/**
 * The whole Assessment for one Session. Teacher-only.
 *
 * @throws when the caller is not a Teacher.
 */
export const getForTeacher = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(v.null(), teacherAssessmentValidator),
  handler: async (ctx, args): Promise<TeacherAssessment | null> => {
    await requireTeacher(ctx);
    const assessment = await assessmentForSession(ctx, args.sessionId);
    return assessment === null ? null : projectForTeacher(assessment);
  },
});

/**
 * Release one Assessment to its Student. The Teacher's shadow-period action.
 *
 * Idempotent, and one-way: there is no un-release. A Student who has read their
 * formative summary cannot un-read it, so a retraction would be a fiction.
 *
 * @throws when the caller is not a Teacher, when the Session has no Assessment,
 * or when the Assessment is not `complete` — there is nothing to release from a
 * run that has not finished or has failed.
 */
export const release = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.object({ released: v.boolean(), releasedAt: v.number() }),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const assessment = await assessmentForSession(ctx, args.sessionId);
    if (assessment === null) {
      throw new Error("That Session has no Assessment to release.");
    }
    if (assessment.status !== "complete") {
      throw new Error(
        `That Assessment is ${assessment.status}; only a complete Assessment ` +
          "can be released to a Student.",
      );
    }
    if (assessment.released) {
      return {
        released: true,
        releasedAt: assessment.releasedAt ?? assessment._creationTime,
      };
    }
    const releasedAt = Date.now();
    await ctx.db.patch("assessments", assessment._id, {
      released: true,
      releasedAt,
    });
    return { released: true, releasedAt };
  },
});

/**
 * Run the Grader again for one Session. The Teacher's recourse when an
 * Assessment failed.
 *
 * Also the repair path for the rare Session that ended with no Transcript rows
 * and therefore no Assessment, and for one whose Transcript landed late: it
 * creates the row if none exists, with `released` decided from the deployment's
 * current release mode exactly as the seal seam would have.
 *
 * @throws when the caller is not a Teacher, when the Session does not exist,
 * when it has not ended, when its Assessment is already `complete` — a complete
 * Assessment is not re-run, because a second opinion that silently replaces the
 * first is not a second opinion — or when a Grader run is still in flight. A
 * second run against a `pending` Assessment is two models grading one Session:
 * two `grader` spendEvents against the budget (INV-4 edge (c)) and two
 * `recordComplete` writes of which the last one wins, so the Assessment a
 * Teacher reads need not be the one whose spend they see. A run that never
 * returns is not stuck forever — the stall sweep turns it into a `failed` this
 * same mutation will happily retry.
 */
export const retry = mutation({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    assessmentId: v.id("assessments"),
    status: assessmentStatus,
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireTeacher(ctx);
    const session = await ctx.db.get("sessions", args.sessionId);
    if (session === null) {
      throw new Error("No such Session.");
    }
    if (session.status !== "ended") {
      throw new Error(
        "That Session has not ended; the Grader only ever runs post-hoc.",
      );
    }
    const config = await getDeploymentConfig(ctx);
    const existing = await assessmentForSession(ctx, args.sessionId);

    if (existing === null) {
      const assessmentId = await createPendingAssessment(
        ctx,
        args.sessionId,
        config.releaseMode,
      );
      return { assessmentId, status: "pending" as const, created: true };
    }
    if (existing.status === "complete") {
      throw new Error(
        "That Assessment is already complete; there is nothing to retry.",
      );
    }
    if (existing.status === "pending") {
      throw new Error(
        "A Grader run for that Session is already in flight. It will be " +
          `marked failed if it has not returned within ${GRADER_STALL_SEC} ` +
          "seconds of being scheduled, and can be retried then.",
      );
    }
    await ctx.db.patch("assessments", existing._id, { status: "pending" });
    await scheduleGrader(ctx, args.sessionId, existing._id);
    return {
      assessmentId: existing._id,
      status: "pending" as const,
      created: false,
    };
  },
});

// ---------------------------------------------------------------------------
// Student surface
// ---------------------------------------------------------------------------

/**
 * The caller's own Assessment, projected down to what a Student may see.
 *
 * The projection is the access rule. Per-Criterion ratings and the INV-1 audit
 * are not withheld by the page that renders this — they never leave the
 * server, so no client can ask for them (PRD §8).
 *
 * @throws when the caller is not the Student this Session belongs to.
 */
export const forStudent = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(v.null(), studentAssessmentValidator),
  handler: async (ctx, args): Promise<StudentAssessment | null> => {
    const student = await requireStudent(ctx);
    const session = await ctx.db.get("sessions", args.sessionId);
    if (session === null || session.studentId !== student._id) {
      // One message for both cases: a Student may not learn whether somebody
      // else's Session id exists.
      throw new Error("Forbidden: that Session does not belong to you.");
    }
    const assessment = await assessmentForSession(ctx, args.sessionId);
    if (assessment === null) {
      return null;
    }
    return {
      status: assessment.status,
      released: assessment.released,
      formativeSummary: assessment.released
        ? (assessment.formativeSummary ?? null)
        : null,
    };
  },
});
