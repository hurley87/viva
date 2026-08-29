// Assignment reads: the container and its immutable published versions.
//
// INV-3 (PRD §4): this module is part of the live-Session path, so it reads
// `assignments` and `assignmentVersions` and nothing else. It holds no import
// of, and no reference to, the Grader-only island that stores what a competent
// response must demonstrate — that module names itself and its rules. A
// Session's Examiner receives the pinned Assignment prompt and nothing more.
//
// Versioning: an Assignment may have many published versions; the highest
// `version` is the one new Sessions pin. Published versions are immutable
// (there is no update mutation for them anywhere), which is what lets a
// Session hold `assignmentVersionId` and be certain the prompt it was examined
// against can never change underneath it.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { requireStudent } from "./lib/identity";

export type AssignmentVersion = Doc<"assignmentVersions">;

/**
 * The highest-`version` published version of an Assignment, or `null` when the
 * Assignment has none (a container that was created but never published).
 *
 * The `by_assignment` index is `[assignmentId, version]`, so a descending scan
 * of that range yields the highest version first.
 */
export async function highestPublishedVersion(
  ctx: QueryCtx | MutationCtx,
  assignmentId: Id<"assignments">,
): Promise<AssignmentVersion | null> {
  return await ctx.db
    .query("assignmentVersions")
    .withIndex("by_assignment", (q) => q.eq("assignmentId", assignmentId))
    .order("desc")
    .first();
}

/**
 * The Assignment a Session was pinned to, resolved from the pinned version.
 * Returns `null` if either row is missing, which callers should treat as a
 * broken Session rather than an empty one.
 */
export async function assignmentForVersion(
  ctx: QueryCtx | MutationCtx,
  assignmentVersionId: Id<"assignmentVersions">,
): Promise<{ version: AssignmentVersion; title: string } | null> {
  const version = await ctx.db.get("assignmentVersions", assignmentVersionId);
  if (version === null) {
    return null;
  }
  const assignment = await ctx.db.get("assignments", version.assignmentId);
  if (assignment === null) {
    return null;
  }
  return { version, title: assignment.title };
}

/**
 * Every Assignment a Student can respond to, each with its currently published
 * prompt. The MVP seeds exactly one; the shape is a list so a second one needs
 * no new function.
 *
 * Assignments with no published version are omitted — there is nothing a
 * Student could be examined on.
 */
export const listForStudent = query({
  args: {},
  returns: v.array(
    v.object({
      assignmentId: v.id("assignments"),
      title: v.string(),
      prompt: v.string(),
      version: v.number(),
    }),
  ),
  handler: async (ctx) => {
    await requireStudent(ctx);
    const assignments = await ctx.db.query("assignments").collect();
    const rows = [];
    for (const assignment of assignments) {
      const version = await highestPublishedVersion(ctx, assignment._id);
      if (version === null) {
        continue;
      }
      rows.push({
        assignmentId: assignment._id,
        title: assignment.title,
        prompt: version.prompt,
        version: version.version,
      });
    }
    return rows;
  },
});
