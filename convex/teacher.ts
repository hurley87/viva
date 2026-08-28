import { v } from "convex/values";
import { assignmentTitleForVersion } from "./lib/assignmentTitle";
import { loadDeploymentConfig } from "./lib/caps";
import { teacherQuery } from "./lib/customFunctions";
import {
  assessmentCriterionValidator,
  assessmentStatusValidator,
  inv1FlagValidator,
  sessionEndReasonValidator,
  sessionStatusValidator,
  transcriptSpeakerValidator,
  transcriptTextStatusValidator,
} from "./lib/validators";

const releaseModeValidator = v.union(v.literal("shadow"), v.literal("auto"));

const sessionListItemValidator = v.object({
  _id: v.id("sessions"),
  status: sessionStatusValidator,
  startedAt: v.number(),
  studentDisplayName: v.string(),
  assignmentTitle: v.string(),
  assessmentStatus: v.union(assessmentStatusValidator, v.literal("none")),
  released: v.boolean(),
  inv1FlagCount: v.number(),
  endedAt: v.optional(v.number()),
});

const transcriptTurnValidator = v.object({
  speaker: transcriptSpeakerValidator,
  text: v.string(),
  textStatus: transcriptTextStatusValidator,
});

const assessmentViewValidator = v.object({
  _id: v.id("assessments"),
  status: assessmentStatusValidator,
  released: v.boolean(),
  criteria: v.optional(v.array(assessmentCriterionValidator)),
  formativeSummary: v.optional(v.string()),
  inv1Flags: v.optional(v.array(inv1FlagValidator)),
  graderModel: v.optional(v.string()),
  releasedAt: v.optional(v.number()),
});

/**
 * Newest-first Session list for the Teacher dashboard.
 * Bounded: a single-course MVP will not approach 200 Sessions.
 */
export const listSessions = teacherQuery({
  args: {},
  returns: v.object({
    releaseMode: releaseModeValidator,
    sessions: v.array(sessionListItemValidator),
  }),
  handler: async (ctx) => {
    const config = await loadDeploymentConfig(ctx);
    const sessions = await ctx.db.query("sessions").order("desc").take(200);

    const items = await Promise.all(
      sessions.map(async (session) => {
        const [student, assessment, assignmentTitle] = await Promise.all([
          ctx.db.get("users", session.studentId),
          ctx.db
            .query("assessments")
            .withIndex("by_session", (q) => q.eq("sessionId", session._id))
            .unique(),
          assignmentTitleForVersion(ctx, session.assignmentVersionId),
        ]);

        return {
          _id: session._id,
          status: session.status,
          startedAt: session.startedAt ?? session._creationTime,
          studentDisplayName: student?.displayName ?? "Unknown Student",
          assignmentTitle,
          assessmentStatus: assessment?.status ?? ("none" as const),
          released: assessment?.released ?? false,
          inv1FlagCount: assessment?.inv1Flags?.length ?? 0,
          ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
        };
      }),
    );

    return {
      releaseMode: config.releaseMode,
      sessions: items,
    };
  },
});

/**
 * Full Teacher review: transcript, complete Assessment, INV-1 flags.
 * Returns null when the Session id does not exist.
 */
export const getSession = teacherQuery({
  args: { sessionId: v.string() },
  returns: v.union(
    v.object({
      session: v.object({
        _id: v.id("sessions"),
        status: sessionStatusValidator,
        startedAt: v.number(),
        studentDisplayName: v.string(),
        studentEmail: v.string(),
        assignmentTitle: v.string(),
        assignmentPrompt: v.string(),
        endedAt: v.optional(v.number()),
        endReason: v.optional(sessionEndReasonValidator),
      }),
      transcript: v.array(transcriptTurnValidator),
      assessment: v.union(assessmentViewValidator, v.null()),
      releaseMode: releaseModeValidator,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const sessionId = ctx.db.normalizeId("sessions", args.sessionId);
    if (!sessionId) {
      return null;
    }
    const session = await ctx.db.get("sessions", sessionId);
    if (!session) {
      return null;
    }

    const [config, student, version, assignmentTitle, assessment, transcriptItems] =
      await Promise.all([
        loadDeploymentConfig(ctx),
        ctx.db.get("users", session.studentId),
        ctx.db.get("assignmentVersions", session.assignmentVersionId),
        assignmentTitleForVersion(ctx, session.assignmentVersionId),
        ctx.db
          .query("assessments")
          .withIndex("by_session", (q) => q.eq("sessionId", session._id))
          .unique(),
        ctx.db
          .query("transcriptItems")
          .withIndex("by_session_order", (q) => q.eq("sessionId", session._id))
          .take(4096),
      ]);

    return {
      session: {
        _id: session._id,
        status: session.status,
        startedAt: session.startedAt ?? session._creationTime,
        studentDisplayName: student?.displayName ?? "Unknown Student",
        studentEmail: student?.email ?? "",
        assignmentTitle,
        assignmentPrompt: version?.prompt ?? "",
        ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
        ...(session.endReason !== undefined
          ? { endReason: session.endReason }
          : {}),
      },
      transcript: transcriptItems.map((item) => ({
        speaker: item.speaker,
        text: item.text,
        textStatus: item.textStatus,
      })),
      assessment: assessment
        ? {
            _id: assessment._id,
            status: assessment.status,
            released: assessment.released,
            ...(assessment.criteria !== undefined
              ? { criteria: assessment.criteria }
              : {}),
            ...(assessment.formativeSummary !== undefined
              ? { formativeSummary: assessment.formativeSummary }
              : {}),
            ...(assessment.inv1Flags !== undefined
              ? { inv1Flags: assessment.inv1Flags }
              : {}),
            ...(assessment.graderModel !== undefined
              ? { graderModel: assessment.graderModel }
              : {}),
            ...(assessment.releasedAt !== undefined
              ? { releasedAt: assessment.releasedAt }
              : {}),
          }
        : null,
      releaseMode: config.releaseMode,
    };
  },
});
