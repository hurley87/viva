// The Student's read surface: everything the Student's own feedback view
// renders, and nothing else that exists.
//
// This module is a PROJECTION BOUNDARY, which is the whole reason it is its own
// file. PRD §8 splits one Assessment two ways — the Teacher sees per-Criterion
// ratings, evidence quotes and the INV-1 audit; the Student sees the formative
// summary and their own Transcript. That split is not a matter of which fields
// a page happens to render. Every value below is built by hand from a `Doc`
// into a narrow literal, and the narrow literal is what leaves the server:
//
//   - a Teacher-only field cannot be returned by accident, because no code path
//     here copies one out of the row;
//   - {@link StudentProjectionIsSafe} makes that a COMPILE-TIME fact — add
//     `criteria` or `inv1Flags` to any projected type and `npm run typecheck`
//     fails in this file;
//   - the `returns` validator on each query is a third, runtime fence.
//
// INV-3 (PRD §4): this module holds no import of, and no reference to, the
// Grader-only island that stores what a competent response must demonstrate.
// A Student never sees the Standard, verbatim or otherwise (PRD §6).
//
// Ownership: every read starts from {@link requireOwnSession}. A Student may
// not learn whether somebody else's Session id even exists, so a Session that
// is missing and a Session that belongs to another Student produce the same
// thrown error. Authorization failures throw (build brief); the honest
// "your feedback is not here yet" cases are returned states, not errors.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { assignmentForVersion } from "./assignments";
import { requireStudent } from "./lib/identity";
import { durationSec } from "./lib/time";

// ---------------------------------------------------------------------------
// The compile-time fence
// ---------------------------------------------------------------------------

/**
 * Keys that must never appear in anything this module returns: the Teacher's
 * half of an Assessment (PRD §8), the Standard's own vocabulary (INV-3), and
 * the identity link that would let one Student's row be read as another's.
 */
type TeacherOnlyKey =
  | "criteria"
  | "criterion"
  | "rating"
  | "ratings"
  | "evidence"
  | "inv1Flags"
  | "graderModel"
  | "standard"
  | "standardId"
  | "descriptor"
  | "studentId"
  | "teacherId"
  | "privyDid";

type Assert<T extends true> = T;

type CarriesNoTeacherField<T> = [Extract<keyof T, TeacherOnlyKey>] extends [
  never,
]
  ? true
  : false;

// ---------------------------------------------------------------------------
// Projected shapes
// ---------------------------------------------------------------------------

/** How far along the Student's feedback is. Every state is an honest one. */
export type FeedbackState =
  /** The Session has not ended. There is nothing to assess yet. */
  | "session_not_ended"
  /** The Session ended with nothing recorded, so no Assessment was opened. */
  | "no_assessment"
  /** The Grader is running. This resolves on its own, within minutes. */
  | "pending"
  /** Shadow period (PRD §8): complete, but the Teacher has not released it. */
  | "awaiting_release"
  /** The Grader could not produce an Assessment. The Teacher can re-run it. */
  | "failed"
  /** Released: the formative summary is the Student's to read. */
  | "released";

const feedbackState = v.union(
  v.literal("session_not_ended"),
  v.literal("no_assessment"),
  v.literal("pending"),
  v.literal("awaiting_release"),
  v.literal("failed"),
  v.literal("released"),
);

/** One of the caller's own Sessions, as the feedback view shows it. */
export type StudentSessionSummary = {
  sessionId: Id<"sessions">;
  createdAt: number;
  status: Doc<"sessions">["status"];
  startedAt: number | null;
  endedAt: number | null;
  endReason: NonNullable<Doc<"sessions">["endReason"]> | null;
  countsAgainstCaps: boolean | null;
  durationSec: number | null;
  assignmentTitle: string;
  assignmentVersion: number;
};

const studentSessionSummary = v.object({
  sessionId: v.id("sessions"),
  createdAt: v.number(),
  status: v.union(
    v.literal("minted"),
    v.literal("live"),
    v.literal("ended"),
  ),
  startedAt: v.union(v.number(), v.null()),
  endedAt: v.union(v.number(), v.null()),
  endReason: v.union(
    v.literal("student_hangup"),
    v.literal("timebox"),
    v.literal("examiner_ended"),
    v.literal("disconnected"),
    v.null(),
  ),
  countsAgainstCaps: v.union(v.boolean(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  assignmentTitle: v.string(),
  assignmentVersion: v.number(),
});

/** One turn of the caller's own Transcript. */
export type StudentTranscriptTurn = {
  itemId: string;
  orderKey: number;
  speaker: Doc<"transcriptItems">["speaker"];
  text: string;
  textStatus: Doc<"transcriptItems">["textStatus"];
};

const studentTranscriptTurn = v.object({
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

/**
 * The Student's half of an Assessment. Three fields, and the formative summary
 * is `null` until the Assessment is released — the shadow period is enforced
 * here, on the server, not by a page choosing not to draw it.
 */
export type StudentAssessmentView = {
  status: Doc<"assessments">["status"];
  released: boolean;
  formativeSummary: string | null;
};

const studentAssessmentView = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("complete"),
    v.literal("failed"),
  ),
  released: v.boolean(),
  formativeSummary: v.union(v.string(), v.null()),
});

/**
 * The whole feedback view in one consistent snapshot: which Session, what was
 * said, and where the Assessment has got to.
 */
export type StudentFeedback = {
  session: StudentSessionSummary;
  assignmentPrompt: string;
  transcript: StudentTranscriptTurn[];
  assessment: StudentAssessmentView | null;
  state: FeedbackState;
};

/**
 * Proof, checked by the compiler, that none of the three projected shapes above
 * can carry a Teacher-only field. This type is deliberately unused at runtime:
 * if a field is ever added to one of those shapes, `Assert` fails its
 * constraint and `npm run typecheck` stops the build here.
 */
export type StudentProjectionIsSafe = [
  Assert<CarriesNoTeacherField<StudentSessionSummary>>,
  Assert<CarriesNoTeacherField<StudentTranscriptTurn>>,
  Assert<CarriesNoTeacherField<StudentAssessmentView>>,
  Assert<CarriesNoTeacherField<StudentFeedback>>,
];

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * The caller's own Session.
 *
 * A local twin of the same check in `convex/sessions.ts` and
 * `convex/transcript.ts`, for the reason stated there: an authorization check
 * is cheap to state twice and expensive to get wrong once. It also keeps this
 * projection module free of any dependency on the mint path.
 *
 * @throws when the caller is not a Student, the Session does not exist, or it
 * belongs to somebody else — one message for all three, so a Student cannot
 * probe for the existence of another Student's Session.
 */
async function requireOwnSession(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
): Promise<Doc<"sessions">> {
  const student = await requireStudent(ctx);
  const session = await ctx.db.get("sessions", sessionId);
  if (session === null || session.studentId !== student._id) {
    throw new Error("Forbidden: that Session does not belong to you.");
  }
  return session;
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

async function assessmentFor(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
): Promise<Doc<"assessments"> | null> {
  return await ctx.db
    .query("assessments")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .unique();
}

/**
 * The Assessment, projected. Named fields only — there is no spread of the row
 * anywhere in this module, so a field added to the table later is invisible
 * here until somebody writes it out by hand.
 */
function projectAssessment(row: Doc<"assessments">): StudentAssessmentView {
  return {
    status: row.status,
    released: row.released,
    // The shadow period, enforced server-side: an unreleased summary is not
    // sent to the browser at all.
    formativeSummary: row.released ? (row.formativeSummary ?? null) : null,
  };
}

function projectSession(
  session: Doc<"sessions">,
  pinned: Awaited<ReturnType<typeof assignmentForVersion>>,
): StudentSessionSummary {
  return {
    sessionId: session._id,
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

/**
 * Where this Session's feedback has got to, decided once, on the server, so
 * every surface that shows it says the same thing.
 *
 * The `no_assessment` state is a real one and not an error: a Session that was
 * minted and never connected records nothing, and `sessions.finalize`
 * deliberately opens no Assessment for it (there would be nothing to evaluate).
 */
function feedbackStateFor(
  session: Doc<"sessions">,
  assessment: Doc<"assessments"> | null,
): FeedbackState {
  if (session.status !== "ended") {
    return "session_not_ended";
  }
  if (assessment === null) {
    return "no_assessment";
  }
  if (assessment.status === "pending") {
    return "pending";
  }
  if (assessment.status === "failed") {
    return "failed";
  }
  return assessment.released ? "released" : "awaiting_release";
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Everything the Student's feedback view for one Session renders: the Session
 * itself, the Assignment it answered, the Student's own Transcript in
 * conversation order, and the Assessment projected down to the formative
 * summary — once it is released, and not before.
 *
 * One query rather than three so that the page reads one consistent snapshot:
 * a Transcript that arrives before its Session, or a summary that appears while
 * the header still says "in progress", is a worse thing for a Student to read
 * than a moment's wait.
 *
 * @throws when the caller is not the Student this Session belongs to.
 */
export const feedbackForSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    session: studentSessionSummary,
    assignmentPrompt: v.string(),
    transcript: v.array(studentTranscriptTurn),
    assessment: v.union(studentAssessmentView, v.null()),
    state: feedbackState,
  }),
  handler: async (ctx, args): Promise<StudentFeedback> => {
    const session = await requireOwnSession(ctx, args.sessionId);
    const pinned = await assignmentForVersion(ctx, session.assignmentVersionId);
    const assessment = await assessmentFor(ctx, args.sessionId);

    // Ordering comes from the index, not from arrival: a turn whose ASR text
    // landed late still sits where it was spoken (ticket #4).
    const rows = await ctx.db
      .query("transcriptItems")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return {
      session: projectSession(session, pinned),
      // The pinned prompt the Student answered — never the latest one, and
      // never what a competent answer had to demonstrate (INV-3).
      assignmentPrompt: pinned?.version.prompt ?? "",
      transcript: rows.map((row) => ({
        itemId: row.itemId,
        orderKey: row.orderKey,
        speaker: row.speaker,
        text: row.text,
        textStatus: row.textStatus,
      })),
      assessment: assessment === null ? null : projectAssessment(assessment),
      state: feedbackStateFor(session, assessment),
    };
  },
});

/**
 * Where each of the caller's own Sessions has got to, for the list on
 * `/student`. Ids and states only — no summary text, no Transcript, nothing
 * that would need to be re-checked at the row level.
 */
export const feedbackStates = query({
  args: {},
  returns: v.array(
    v.object({ sessionId: v.id("sessions"), state: feedbackState }),
  ),
  handler: async (
    ctx,
  ): Promise<{ sessionId: Id<"sessions">; state: FeedbackState }[]> => {
    const student = await requireStudent(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_student", (q) => q.eq("studentId", student._id))
      .order("desc")
      .take(50);
    const rows: { sessionId: Id<"sessions">; state: FeedbackState }[] = [];
    for (const session of sessions) {
      const assessment = await assessmentFor(ctx, session._id);
      rows.push({
        sessionId: session._id,
        state: feedbackStateFor(session, assessment),
      });
    }
    return rows;
  },
});
