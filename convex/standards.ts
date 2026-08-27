import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * INV-3 module boundary.
 *
 * This is the only module that may write the `standards` table (seed also
 * inserts the demo Standard). `convex/grader/*` is the only Session-path
 * reader. Mint and examiner code must never import this file — that lint
 * lands in issue #8. Do not add examiner/mint helpers here.
 */

export const criterionValidator = v.object({
  name: v.string(),
  descriptor: v.string(),
});

export type Criterion = {
  name: string;
  descriptor: string;
};

const MIN_CRITERIA = 3;
const MAX_CRITERIA = 7;

export async function insertStandard(
  ctx: MutationCtx,
  args: {
    assignmentVersionId: Id<"assignmentVersions">;
    criteria: Criterion[];
  },
): Promise<Id<"standards">> {
  if (
    args.criteria.length < MIN_CRITERIA ||
    args.criteria.length > MAX_CRITERIA
  ) {
    throw new Error(
      `A Standard must have ${MIN_CRITERIA}–${MAX_CRITERIA} named criteria`,
    );
  }

  return await ctx.db.insert("standards", {
    assignmentVersionId: args.assignmentVersionId,
    criteria: args.criteria,
  });
}

export async function getStandardByVersion(
  ctx: QueryCtx | MutationCtx,
  assignmentVersionId: Id<"assignmentVersions">,
) {
  return await ctx.db
    .query("standards")
    .withIndex("by_version", (q) =>
      q.eq("assignmentVersionId", assignmentVersionId),
    )
    .unique();
}
