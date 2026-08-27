import { v } from "convex/values";
import { teacherMutation, teacherQuery } from "./lib/customFunctions";

const shareViewValidator = v.object({
  _id: v.id("transcriptShares"),
  sessionId: v.id("sessions"),
  grantedByTeacherId: v.id("users"),
  reason: v.string(),
  _creationTime: v.number(),
});

/**
 * INV-2 break-glass grant. Rows are a permanent, visible log — do not add a
 * delete or revoke mutation.
 */
export const grant = teacherMutation({
  args: {
    sessionId: v.id("sessions"),
    reason: v.string(),
  },
  returns: v.id("transcriptShares"),
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (reason.length === 0) {
      throw new Error("Share reason is required");
    }

    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const existing = await ctx.db
      .query("transcriptShares")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("transcriptShares", {
      sessionId: args.sessionId,
      grantedByTeacherId: ctx.user._id,
      reason,
    });
  },
});

/** Teacher-visible share metadata for a Session. Never deleted. */
export const getForSession = teacherQuery({
  args: { sessionId: v.id("sessions") },
  returns: v.union(shareViewValidator, v.null()),
  handler: async (ctx, args) => {
    const share = await ctx.db
      .query("transcriptShares")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();
    if (!share) {
      return null;
    }
    return {
      _id: share._id,
      sessionId: share.sessionId,
      grantedByTeacherId: share.grantedByTeacherId,
      reason: share.reason,
      _creationTime: share._creationTime,
    };
  },
});
