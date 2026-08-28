/**
 * Student-callable post-Session projection (PRD §8).
 *
 * Return types are the access control: these functions never include
 * per-criterion ratings, INV-1 flags, Standard content, or another
 * Student's data. Teacher-only fields stay on the Assessment row.
 */
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { assignmentTitleForVersion } from "./lib/assignmentTitle";
import { studentQuery } from "./lib/customFunctions";
import {
  sessionEndReasonValidator,
  sessionStatusValidator,
  transcriptSpeakerValidator,
  transcriptTextStatusValidator,
} from "./lib/validators";

const TRANSCRIPT_TAKE = 512;
const SESSION_LIST_TAKE = 50;

const studentTranscriptTurnValidator = v.object({
  speaker: transcriptSpeakerValidator,
  text: v.string(),
  textStatus: transcriptTextStatusValidator,
});

const studentFeedbackStateValidator = v.union(
  v.object({
    state: v.literal("released"),
    formativeSummary: v.string(),
  }),
  v.object({
    state: v.literal("pending"),
  }),
);

const studentSessionSummaryValidator = v.object({
  sessionId: v.id("sessions"),
  assignmentTitle: v.string(),
  endedAt: v.optional(v.number()),
  feedbackState: v.union(v.literal("released"), v.literal("pending")),
});

const studentSessionFeedbackValidator = v.object({
  sessionId: v.id("sessions"),
  assignmentTitle: v.string(),
  status: sessionStatusValidator,
  endedAt: v.optional(v.number()),
  endReason: v.optional(sessionEndReasonValidator),
  transcript: v.array(studentTranscriptTurnValidator),
  feedback: studentFeedbackStateValidator,
});

function projectReleasedSummary(
  assessment: Doc<"assessments"> | null,
):
  | { state: "released"; formativeSummary: string }
  | { state: "pending" } {
  if (
    assessment !== null &&
    assessment.released &&
    assessment.status === "complete" &&
    assessment.formativeSummary !== undefined &&
    assessment.formativeSummary.length > 0
  ) {
    return {
      state: "released",
      formativeSummary: assessment.formativeSummary,
    };
  }
  return { state: "pending" };
}

async function assessmentForSession(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
): Promise<Doc<"assessments"> | null> {
  return await ctx.db
    .query("assessments")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .unique();
}

async function transcriptForSession(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
) {
  const rows = await ctx.db
    .query("transcriptItems")
    .withIndex("by_session_order", (q) => q.eq("sessionId", sessionId))
    .take(TRANSCRIPT_TAKE);

  return rows.map((row) => ({
    speaker: row.speaker,
    text: row.text,
    textStatus: row.textStatus,
  }));
}

export const listMine = studentQuery({
  args: {},
  returns: v.array(studentSessionSummaryValidator),
  handler: async (ctx) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_student_ended", (q) => q.eq("studentId", ctx.user._id))
      .order("desc")
      .take(SESSION_LIST_TAKE);

    const ended = sessions.filter(
      (session) => session.status === "ended" && session.endedAt !== undefined,
    );

    return await Promise.all(
      ended.map(async (session) => {
        const [assessment, assignmentTitle] = await Promise.all([
          assessmentForSession(ctx, session._id),
          assignmentTitleForVersion(ctx, session.assignmentVersionId),
        ]);
        const feedback = projectReleasedSummary(assessment);
        return {
          sessionId: session._id,
          assignmentTitle,
          feedbackState: feedback.state,
          ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
        };
      }),
    );
  },
});

export const getMine = studentQuery({
  args: { sessionId: v.string() },
  returns: v.union(studentSessionFeedbackValidator, v.null()),
  handler: async (ctx, args) => {
    const sessionId = ctx.db.normalizeId("sessions", args.sessionId);
    if (!sessionId) {
      return null;
    }
    const session = await ctx.db.get("sessions", sessionId);
    if (!session || session.studentId !== ctx.user._id) {
      return null;
    }

    const [assignmentTitle, assessment, transcript] = await Promise.all([
      assignmentTitleForVersion(ctx, session.assignmentVersionId),
      assessmentForSession(ctx, session._id),
      transcriptForSession(ctx, session._id),
    ]);

    return {
      sessionId: session._id,
      assignmentTitle,
      status: session.status,
      transcript,
      feedback: projectReleasedSummary(assessment),
      ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
      ...(session.endReason !== undefined
        ? { endReason: session.endReason }
        : {}),
    };
  },
});
