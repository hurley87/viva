import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

const FALLBACK_TITLE = "Assignment";

export async function assignmentTitleForVersion(
  ctx: QueryCtx | MutationCtx,
  assignmentVersionId: Id<"assignmentVersions">,
): Promise<string> {
  const version = await ctx.db.get("assignmentVersions", assignmentVersionId);
  if (!version) {
    return FALLBACK_TITLE;
  }
  const assignment = await ctx.db.get("assignments", version.assignmentId);
  return assignment?.title ?? FALLBACK_TITLE;
}
