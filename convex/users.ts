import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { getActiveUserOrNull } from "./lib/auth";
import { authedQuery } from "./lib/customFunctions";
import {
  roleValidator,
  userPublicValidator,
} from "./lib/validators";

function toPublicUser(user: Doc<"users">) {
  return {
    _id: user._id,
    _creationTime: user._creationTime,
    privyDid: user.privyDid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const me = query({
  args: {},
  returns: v.union(userPublicValidator, v.null()),
  handler: async (ctx) => {
    const user = await getActiveUserOrNull(ctx);
    return user ? toPublicUser(user) : null;
  },
});

/**
 * Strict caller lookup: throws when unauthenticated or voided.
 * Use this (or authedQuery/authedMutation) for any function that reads
 * user-owned data.
 */
export const whoami = authedQuery({
  args: {},
  returns: userPublicValidator,
  handler: async (ctx) => {
    return toPublicUser(ctx.user);
  },
});

const provisionResultValidator = v.object({
  userId: v.id("users"),
  created: v.boolean(),
});

async function provisionUser(
  ctx: MutationCtx,
  args: {
    privyDid: string;
    email: string;
    displayName: string;
    role: "teacher" | "student" | "operator";
  },
) {
  const email = normalizeEmail(args.email);
  const existingByEmail = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  const existingByDid = await ctx.db
    .query("users")
    .withIndex("by_privyDid", (q) => q.eq("privyDid", args.privyDid))
    .unique();

  if (
    existingByEmail &&
    existingByDid &&
    existingByEmail._id !== existingByDid._id
  ) {
    throw new Error("Email and Privy DID belong to different user rows");
  }

  const existing = existingByEmail ?? existingByDid;
  if (existing) {
    await ctx.db.patch("users", existing._id, {
      privyDid: args.privyDid,
      email,
      displayName: args.displayName,
      role: args.role,
      status: "active",
    });
    return { userId: existing._id, created: false };
  }

  const userId = await ctx.db.insert("users", {
    privyDid: args.privyDid,
    email,
    displayName: args.displayName,
    role: args.role,
    status: "active",
  });
  return { userId, created: true };
}

/**
 * CLI-only account insert. Run via:
 *   npx convex run users:provisionInternal '{"privyDid":"...","email":"...","displayName":"...","role":"student"}'
 */
export const provisionInternal = internalMutation({
  args: {
    privyDid: v.string(),
    email: v.string(),
    displayName: v.string(),
    role: roleValidator,
  },
  returns: provisionResultValidator,
  handler: async (ctx, args) => {
    return await provisionUser(ctx, args);
  },
});

const voidResultValidator = v.object({
  userId: v.id("users"),
  privyDid: v.string(),
  alreadyVoided: v.boolean(),
});

/**
 * CLI-only status flip. The provision:void script then deletes the Privy user.
 */
export const voidInternal = internalMutation({
  args: {
    email: v.string(),
  },
  returns: voidResultValidator,
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    const alreadyVoided = user.status === "voided";
    if (!alreadyVoided) {
      await ctx.db.patch("users", user._id, { status: "voided" });
    }

    return {
      userId: user._id,
      privyDid: user.privyDid,
      alreadyVoided,
    };
  },
});
