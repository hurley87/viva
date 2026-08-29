// The Teacher's read surface: every Session in the deployment, and one
// Session opened up in full.
//
// Read-mostly by design. Authoring stays seeded in the MVP (build brief), so
// nothing here creates or edits an Assignment; the Teacher's one write is the
// shadow-period release, which already exists as `assessments.release` and is
// reused rather than duplicated.
//
// Access (PRD §6): a Teacher reads all Transcripts and all Assessments. Every
// function in this module therefore begins with `requireTeacher`, which throws
// for a Student, for an Operator, for an unauthenticated caller, and for a
// voided account. There is no argument anywhere below that widens or narrows
// that — the role is the whole rule.
//
// INV-3 (PRD §4): this module reads `assignments` and `assignmentVersions` for
// titles and version numbers and nothing else. It holds no import of, and no
// reference to, the Grader-only island that stores what a competent response
// must demonstrate. A dashboard has no reason to load a Standard, and keeping
// it out keeps ticket #8's static check clean.
//
// PRD §8 vocabulary: ratings are qualitative and stay qualitative. Nothing
// here counts, averages, or ranks Criterion ratings — the counts that do exist
// are of rows (how many Criteria, how many INV-1 flags), which is navigation,
// not measurement.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { assignmentForVersion } from "./assignments";
import { getDeploymentConfigOrNull } from "./lib/config";
import { requireTeacher } from "./lib/identity";
import { durationSec } from "./lib/time";
import type { TranscriptRow } from "./transcript";

/** How many Sessions the list surfaces. The MVP deployment has far fewer. */
const LIST_LIMIT = 200;

// ---------------------------------------------------------------------------
// Validators
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

const assessmentStatus = v.union(
  v.literal("pending"),
  v.literal("complete"),
  v.literal("failed"),
);

/**
 * The release mode of the deployment, or `null` when it has not been seeded.
 *
 * Nullable rather than thrown: an unconfigured deployment is a broken one, but
 * a review surface that refuses to render at all is a worse way to find that
 * out than a sentence saying so. Nothing here enforces a cap, so nothing here
 * has to fail closed.
 */
const releaseModeValidator = v.union(
  v.literal("shadow"),
  v.literal("auto"),
  v.null(),
);

/**
 * Enough of an Assessment to find the one you want in a list. The ratings
 * themselves are deliberately absent — a list is for navigation, and a rating
 * read out of the evidence that supports it is exactly the summary-at-a-glance
 * the product refuses to produce (PRD §8).
 */
const assessmentSummary = v.object({
  status: assessmentStatus,
  released: v.boolean(),
  releasedAt: v.union(v.number(), v.null()),
  criterionCount: v.number(),
  inv1FlagCount: v.number(),
});

const teacherSessionValidator = v.object({
  _id: v.id("sessions"),
  createdAt: v.number(),
  status: sessionStatus,
  startedAt: v.union(v.number(), v.null()),
  endedAt: v.union(v.number(), v.null()),
  endReason: v.union(endReasonValidator, v.null()),
  countsAgainstCaps: v.union(v.boolean(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  studentName: v.string(),
  studentEmail: v.string(),
  assignmentTitle: v.string(),
  assignmentVersion: v.number(),
  assessment: v.union(v.null(), assessmentSummary),
});

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

export type ReleaseMode = Doc<"deploymentConfig">["releaseMode"];

export type AssessmentSummary = {
  status: Doc<"assessments">["status"];
  released: boolean;
  releasedAt: number | null;
  criterionCount: number;
  inv1FlagCount: number;
};

export type TeacherSession = {
  _id: Id<"sessions">;
  createdAt: number;
  status: Doc<"sessions">["status"];
  startedAt: number | null;
  endedAt: number | null;
  endReason: NonNullable<Doc<"sessions">["endReason"]> | null;
  countsAgainstCaps: boolean | null;
  durationSec: number | null;
  studentName: string;
  studentEmail: string;
  assignmentTitle: string;
  assignmentVersion: number;
  assessment: AssessmentSummary | null;
};

export type TeacherSessionList = {
  releaseMode: ReleaseMode | null;
  sessions: TeacherSession[];
};

export type TeacherSessionDetail = {
  releaseMode: ReleaseMode | null;
  session: TeacherSession;
  assignmentPrompt: string;
  transcript: TranscriptRow[];
};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function summarizeAssessment(row: Doc<"assessments"> | null): AssessmentSummary | null {
  if (row === null) {
    return null;
  }
  return {
    status: row.status,
    released: row.released,
    releasedAt: row.releasedAt ?? null,
    // Absent while `pending` or `failed` — a Grader run that has not landed
    // has no Criteria and no audit, and zero is the honest count for that.
    criterionCount: row.criteria?.length ?? 0,
    inv1FlagCount: row.inv1Flags?.length ?? 0,
  };
}

/**
 * A tiny per-query cache for the two lookups a Session row needs beyond its
 * own document. One seeded Assignment and a handful of Students means the list
 * would otherwise re-read the same two rows once per Session.
 */
type Lookups = {
  students: Map<string, Doc<"users"> | null>;
  assignments: Map<string, { title: string; version: number; prompt: string }>;
};

function newLookups(): Lookups {
  return { students: new Map(), assignments: new Map() };
}

async function studentFor(
  ctx: QueryCtx,
  lookups: Lookups,
  studentId: Id<"users">,
): Promise<Doc<"users"> | null> {
  const cached = lookups.students.get(studentId);
  if (cached !== undefined) {
    return cached;
  }
  const row = await ctx.db.get("users", studentId);
  lookups.students.set(studentId, row);
  return row;
}

async function assignmentFor(
  ctx: QueryCtx,
  lookups: Lookups,
  assignmentVersionId: Id<"assignmentVersions">,
): Promise<{ title: string; version: number; prompt: string }> {
  const cached = lookups.assignments.get(assignmentVersionId);
  if (cached !== undefined) {
    return cached;
  }
  const pinned = await assignmentForVersion(ctx, assignmentVersionId);
  const resolved =
    pinned === null
      ? { title: "Assignment", version: 0, prompt: "" }
      : {
          title: pinned.title,
          version: pinned.version.version,
          prompt: pinned.version.prompt,
        };
  lookups.assignments.set(assignmentVersionId, resolved);
  return resolved;
}

async function projectSession(
  ctx: QueryCtx,
  lookups: Lookups,
  session: Doc<"sessions">,
): Promise<TeacherSession> {
  const student = await studentFor(ctx, lookups, session.studentId);
  // The pin, not the latest version: a Session is always shown against the
  // Assignment version it was actually examined against.
  const assignment = await assignmentFor(
    ctx,
    lookups,
    session.assignmentVersionId,
  );
  const assessment = await ctx.db
    .query("assessments")
    .withIndex("by_session", (q) => q.eq("sessionId", session._id))
    .unique();

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
    studentName: student?.displayName ?? "Unknown Student",
    studentEmail: student?.email ?? "",
    assignmentTitle: assignment.title,
    assignmentVersion: assignment.version,
    assessment: summarizeAssessment(assessment),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every Session in the deployment, newest first, with enough state for the
 * Teacher to find the one they want: who took it, which Assignment version,
 * how it ended, whether it counted against that Student's caps, and where its
 * Assessment has got to — including whether it has reached the Student.
 *
 * `releaseMode` rides along because it decides whether a release control is a
 * real action or a fact already settled at Session end (PRD §8).
 *
 * @throws when the caller is not a Teacher.
 */
export const listSessions = query({
  args: {},
  returns: v.object({
    releaseMode: releaseModeValidator,
    sessions: v.array(teacherSessionValidator),
  }),
  handler: async (ctx): Promise<TeacherSessionList> => {
    await requireTeacher(ctx);
    const config = await getDeploymentConfigOrNull(ctx);
    const sessions = await ctx.db
      .query("sessions")
      .order("desc")
      .take(LIST_LIMIT);

    const lookups = newLookups();
    const rows: TeacherSession[] = [];
    for (const session of sessions) {
      rows.push(await projectSession(ctx, lookups, session));
    }
    return { releaseMode: config?.releaseMode ?? null, sessions: rows };
  },
});

/**
 * One Session opened up: its state, the Assignment prompt it was examined
 * against, and the whole Transcript in conversation order.
 *
 * The Assessment itself is deliberately not here. `assessments.getForTeacher`
 * already returns it, already carries the same Teacher check, and is already
 * the thing the release path reads — two functions returning the same rows
 * would be two things to keep in step.
 *
 * Returns `null` for a Session id that does not exist. A Teacher may read
 * every Session in the deployment, so there is nothing to conceal by
 * conflating that with a refusal.
 *
 * @throws when the caller is not a Teacher.
 */
export const getSession = query({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.null(),
    v.object({
      releaseMode: releaseModeValidator,
      session: teacherSessionValidator,
      assignmentPrompt: v.string(),
      transcript: v.array(transcriptRowValidator),
    }),
  ),
  handler: async (ctx, args): Promise<TeacherSessionDetail | null> => {
    await requireTeacher(ctx);
    const session = await ctx.db.get("sessions", args.sessionId);
    if (session === null) {
      return null;
    }
    const config = await getDeploymentConfigOrNull(ctx);
    const lookups = newLookups();
    const assignment = await assignmentFor(
      ctx,
      lookups,
      session.assignmentVersionId,
    );
    // The ordered read lives in convex/transcript.ts and stays there: the
    // ordering rule ("where it was spoken, not when its text landed") is that
    // module's, and is not worth restating here.
    const transcript: TranscriptRow[] = await ctx.runQuery(
      internal.transcript.itemsForSession,
      { sessionId: args.sessionId },
    );

    return {
      releaseMode: config?.releaseMode ?? null,
      session: await projectSession(ctx, lookups, session),
      assignmentPrompt: assignment.prompt,
      transcript,
    };
  },
});
