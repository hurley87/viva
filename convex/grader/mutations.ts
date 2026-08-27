import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { loadDeploymentConfig } from "../lib/caps";
import {
  assessmentCriterionValidator,
  inv1FlagValidator,
} from "../lib/validators";

async function assessmentBySession(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
) {
  return await ctx.db
    .query("assessments")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .unique();
}

export const writeAssessment = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    criteria: v.array(assessmentCriterionValidator),
    formativeSummary: v.string(),
    inv1Flags: v.array(inv1FlagValidator),
    graderModel: v.string(),
    usd: v.number(),
  },
  returns: v.id("assessments"),
  handler: async (ctx, args) => {
    const assessment = await assessmentBySession(ctx, args.sessionId);
    if (!assessment) {
      throw new Error("Assessment not found");
    }
    if (assessment.status === "complete") {
      return assessment._id;
    }

    const config = await loadDeploymentConfig(ctx);
    const released = config.releaseMode === "auto";
    const now = Date.now();

    await ctx.db.patch("assessments", assessment._id, {
      status: "complete",
      criteria: args.criteria,
      formativeSummary: args.formativeSummary,
      inv1Flags: args.inv1Flags,
      graderModel: args.graderModel,
      released,
      ...(released ? { releasedAt: now } : {}),
    });

    await ctx.db.insert("spendEvents", {
      kind: "grader",
      sessionId: args.sessionId,
      usd: args.usd,
    });

    return assessment._id;
  },
});

export const markFailed = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    usd: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assessment = await assessmentBySession(ctx, args.sessionId);
    if (!assessment) {
      throw new Error("Assessment not found");
    }
    if (assessment.status === "complete") {
      return null;
    }

    await ctx.db.patch("assessments", assessment._id, {
      status: "failed",
    });

    if (args.usd !== undefined) {
      await ctx.db.insert("spendEvents", {
        kind: "grader",
        sessionId: args.sessionId,
        usd: args.usd,
      });
    }

    return null;
  },
});

export async function retryFailedAssessment(
  ctx: MutationCtx,
  assessmentId: Id<"assessments">,
): Promise<Id<"sessions">> {
  const assessment = await ctx.db.get("assessments", assessmentId);
  if (!assessment) {
    throw new Error("Assessment not found");
  }
  if (assessment.status !== "failed") {
    throw new Error("Only failed Assessments can be retried");
  }

  await ctx.db.patch("assessments", assessment._id, {
    status: "pending",
  });

  await ctx.scheduler.runAfter(0, internal.grader.actions.gradeSession, {
    sessionId: assessment.sessionId,
  });

  return assessment.sessionId;
}

export const retry = internalMutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    return await retryFailedAssessment(ctx, args.assessmentId);
  },
});
