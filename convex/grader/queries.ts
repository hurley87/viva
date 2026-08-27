import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { getStandardByVersion } from "../standards";
import { graderTranscriptTurnValidator } from "../lib/validators";

const criterionValidator = v.object({
  name: v.string(),
  descriptor: v.string(),
});

/**
 * INV-3: this module is the only reader of `standards` besides standards.ts
 * itself. Do not call this from examiner or mint code.
 */
export const loadGradingContext = internalQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.union(
    v.object({
      kind: v.literal("skip"),
      reason: v.string(),
    }),
    v.object({
      kind: v.literal("ready"),
      sessionId: v.id("sessions"),
      assessmentId: v.id("assessments"),
      assignmentPrompt: v.string(),
      criteria: v.array(criterionValidator),
      transcript: v.array(graderTranscriptTurnValidator),
    }),
    v.object({
      kind: v.literal("unready"),
      reason: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) {
      return { kind: "unready" as const, reason: "Session not found" };
    }

    const assessment = await ctx.db
      .query("assessments")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    if (!assessment) {
      return {
        kind: "unready" as const,
        reason: "Assessment row is missing",
      };
    }

    if (assessment.status === "complete") {
      return {
        kind: "skip" as const,
        reason: "Assessment already complete",
      };
    }

    const version = await ctx.db.get(
      "assignmentVersions",
      session.assignmentVersionId,
    );
    if (!version) {
      return {
        kind: "unready" as const,
        reason: "Pinned Assignment version is missing",
      };
    }

    const standard = await getStandardByVersion(
      ctx,
      session.assignmentVersionId,
    );
    if (!standard) {
      return {
        kind: "unready" as const,
        reason: "Pinned Standard is missing",
      };
    }

    const transcriptRows = await ctx.db
      .query("transcriptItems")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .take(512);

    return {
      kind: "ready" as const,
      sessionId: session._id,
      assessmentId: assessment._id,
      assignmentPrompt: version.prompt,
      criteria: standard.criteria,
      transcript: transcriptRows.map((row) => ({
        speaker: row.speaker,
        text: row.text,
        textStatus: row.textStatus,
      })),
    };
  },
});
