// ============================================================================
// INV-3 ISLAND — the Standard never enters the live Session.
//
// THIS IS THE ONLY MODULE IN THE CODEBASE THAT MAY TOUCH THE `standards`
// TABLE. Do not read, write, or name that table anywhere else.
//
// Rules for contributors:
//   - The mint and Examiner path — convex/sessions.ts, convex/assignments.ts,
//     convex/examiner/** — must contain no import of this module and no
//     occurrence of the string "standards". A Session's Examiner receives the
//     pinned Assignment prompt and nothing else (PRD §7, INV-3).
//   - convex/grader/** is the ONLY consumer: the Grader reads the Standard for
//     the Session's pinned Assignment version after the Session has ended.
//   - Everything exported here is `internal*`, so no client can call it and no
//     Standard content can ever be projected to a Student or an Operator.
//   - Published Standards are immutable by construction: there is no update or
//     patch mutation for `standards`, and none may be added. Editing a
//     Standard means publishing a new Assignment version with a new Standard.
//
// The physical separation is the mechanism; a static check in the invariant
// test suite asserts it. Breaking it silently breaks INV-3.
// ============================================================================

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const criterion = v.object({
  name: v.string(),
  descriptor: v.string(), // 1–3 sentences (PRD §8)
});

/**
 * Read the Standard pinned to one Assignment version. Grader-only.
 *
 * Returns `null` when an Assignment version has no Standard — a published
 * version should always have one, so the Grader treats this as a hard failure
 * rather than grading against nothing.
 */
export const getStandardForVersion = internalQuery({
  args: { assignmentVersionId: v.id("assignmentVersions") },
  returns: v.union(
    v.object({
      _id: v.id("standards"),
      assignmentVersionId: v.id("assignmentVersions"),
      criteria: v.array(criterion),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const standard = await ctx.db
      .query("standards")
      .withIndex("by_version", (q) =>
        q.eq("assignmentVersionId", args.assignmentVersionId),
      )
      .unique();
    if (standard === null) return null;
    return {
      _id: standard._id,
      assignmentVersionId: standard.assignmentVersionId,
      criteria: standard.criteria,
    };
  },
});

/**
 * Create the Standard for a newly published Assignment version.
 *
 * Idempotent: if the version already has a Standard, the existing one is
 * returned untouched. There is deliberately no update path — a published
 * Standard is immutable, so changing one means publishing a new Assignment
 * version (PRD §2).
 */
export const createStandardForVersion = internalMutation({
  args: {
    assignmentVersionId: v.id("assignmentVersions"),
    criteria: v.array(criterion),
  },
  returns: v.object({ standardId: v.id("standards"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("standards")
      .withIndex("by_version", (q) =>
        q.eq("assignmentVersionId", args.assignmentVersionId),
      )
      .unique();
    if (existing !== null) {
      return { standardId: existing._id, created: false };
    }
    const standardId = await ctx.db.insert("standards", {
      assignmentVersionId: args.assignmentVersionId,
      criteria: args.criteria,
    });
    return { standardId, created: true };
  },
});
