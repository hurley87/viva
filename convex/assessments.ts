import { v } from "convex/values";
import { retryFailedAssessment } from "./grader/mutations";
import { teacherMutation } from "./lib/customFunctions";

/**
 * Teacher release after shadow-period review. Idempotent if already released.
 * Student projection of formativeSummary is ticket #6 — this only flips the flag.
 */
export const release = teacherMutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const assessment = await ctx.db.get("assessments", args.assessmentId);
    if (!assessment) {
      throw new Error("Assessment not found");
    }
    if (assessment.status !== "complete") {
      throw new Error("Assessment is not complete");
    }
    if (assessment.released) {
      return null;
    }

    await ctx.db.patch("assessments", assessment._id, {
      released: true,
      releasedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Re-run the Grader after a failed pass. Pending/complete rows are rejected.
 */
export const retry = teacherMutation({
  args: { assessmentId: v.id("assessments") },
  returns: v.id("sessions"),
  handler: async (ctx, args) => {
    return await retryFailedAssessment(ctx, args.assessmentId);
  },
});
