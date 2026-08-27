import { v } from "convex/values";
import { loadDeploymentConfig, sumSpendThisMonth } from "./lib/caps";
import { operatorQuery } from "./lib/customFunctions";
import {
  transcriptSpeakerValidator,
  transcriptTextStatusValidator,
} from "./lib/validators";

const sharedTranscriptItemValidator = v.object({
  speaker: transcriptSpeakerValidator,
  text: v.string(),
  textStatus: transcriptTextStatusValidator,
  orderKey: v.number(),
});

/**
 * INV-2 break-glass: Operator may read transcript bodies only when a Teacher
 * has granted a `transcriptShares` row for that Session. Never returns
 * Assessment content or Student identity.
 */
export const getSharedTranscript = operatorQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    sessionId: v.id("sessions"),
    shareReason: v.string(),
    grantedAt: v.number(),
    items: v.array(sharedTranscriptItemValidator),
  }),
  handler: async (ctx, args) => {
    const share = await ctx.db
      .query("transcriptShares")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!share) {
      throw new Error("Unauthorized: Teacher share required");
    }

    const items = await ctx.db
      .query("transcriptItems")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .take(512);

    return {
      sessionId: args.sessionId,
      shareReason: share.reason,
      grantedAt: share._creationTime,
      items: items.map((item) => ({
        speaker: item.speaker,
        text: item.text,
        textStatus: item.textStatus,
        orderKey: item.orderKey,
      })),
    };
  },
});

/**
 * Operator aggregates only — counts and spend, never utterance or Student PII.
 */
export const metrics = operatorQuery({
  args: { now: v.number() },
  returns: v.object({
    sessionCount: v.number(),
    spendUsd: v.number(),
    shareCount: v.number(),
    completeAssessmentCount: v.number(),
    inv1FlagCount: v.number(),
    monthlyBudgetUsd: v.number(),
  }),
  handler: async (ctx, args) => {
    const config = await loadDeploymentConfig(ctx);
    const sessions = await ctx.db.query("sessions").take(4096);
    const shares = await ctx.db.query("transcriptShares").take(4096);
    const assessments = await ctx.db.query("assessments").take(4096);

    let completeAssessmentCount = 0;
    let inv1FlagCount = 0;
    for (const assessment of assessments) {
      if (assessment.status === "complete") {
        completeAssessmentCount += 1;
      }
      inv1FlagCount += assessment.inv1Flags?.length ?? 0;
    }

    return {
      sessionCount: sessions.length,
      spendUsd: await sumSpendThisMonth(ctx, args.now),
      shareCount: shares.length,
      completeAssessmentCount,
      inv1FlagCount,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
    };
  },
});
