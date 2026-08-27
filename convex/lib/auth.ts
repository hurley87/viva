import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export async function getActiveUserOrNull(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_privyDid", (q) => q.eq("privyDid", identity.subject))
    .unique();

  if (!user || user.status === "voided") {
    return null;
  }

  return user;
}

export async function requireUser(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_privyDid", (q) => q.eq("privyDid", identity.subject))
    .unique();

  if (!user || user.status === "voided") {
    throw new Error("Unauthorized");
  }

  return user;
}

export async function requireStudent(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "student") {
    throw new Error("Unauthorized: Student access required");
  }
  return user;
}
