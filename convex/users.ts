// The `users` table: one public self-read, plus the two internal mutations the
// provision script drives.
//
// Accounts are never created by signing in. `provision` (CONTEXT.md
// Operations — never "mint", which is reserved for Sessions) pre-creates the
// Privy user, allowlists the email, and calls `provisionUser` below with the
// DID Privy returned. Signing in can therefore only ever *match* a row that an
// operator already wrote.
//
// Both mutations are `internalMutation`: they are reachable from
// `scripts/provision.ts` via `npx convex run`, and from nothing a browser can
// reach.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, query } from "./_generated/server";
import { getUser } from "./lib/identity";

/**
 * Placeholder DID carried by the seeded Teacher (convex/seed.ts). It can never
 * appear in a real access token, so the seeded row is unreachable by login
 * until a real Teacher adopts it — see {@link provisionUser}.
 */
const SEED_TEACHER_PRIVY_DID = "did:privy:seed-teacher";

const roleValidator = v.union(
  v.literal("teacher"),
  v.literal("student"),
  v.literal("operator"),
);

/** Emails are matched case-insensitively and stored normalized. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The `users` table has no email index (the approved schema indexes only
 * `by_privyDid`) and holds a handful of hand-provisioned rows in the MVP, so
 * the operator-only lookups below scan it. Revisit if a roster UI ever lands.
 */
async function findByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  const wanted = normalizeEmail(email);
  const rows = await ctx.db.query("users").collect();
  return rows.find((row) => normalizeEmail(row.email) === wanted) ?? null;
}

// ---------------------------------------------------------------------------
// Public read
// ---------------------------------------------------------------------------

/**
 * The caller's own record — and only ever the caller's own. There is no
 * argument to point this at somebody else's row.
 *
 * Returns `null` for an unauthenticated caller, for a verified Privy DID with
 * no Viva record, and for a voided account. The client distinguishes those
 * cases by pairing this with Privy's own `authenticated` flag: authenticated
 * plus `null` means "signed in, but this account is not provisioned".
 */
export const me = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("users"),
      email: v.string(),
      displayName: v.string(),
      role: roleValidator,
    }),
  ),
  handler: async (ctx) => {
    const user = await getUser(ctx);
    if (user === null) {
      return null;
    }
    return {
      _id: user._id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal provisioning
// ---------------------------------------------------------------------------

/**
 * What `provisionUser` did, so the script can report it honestly. Mirrored in
 * `scripts/provision.ts`, which turns each into a sentence for the operator.
 */
const provisionActionValidator = v.union(
  v.literal("created"),
  v.literal("updated_by_did"),
  v.literal("adopted_by_email"),
  v.literal("adopted_seed_teacher"),
);

/**
 * Insert or adopt the Convex record for a provisioned account. Idempotent:
 * re-running the provision script for the same person converges rather than
 * duplicating, and always leaves the row `active`.
 *
 * Resolution order:
 *  1. a row already carrying this Privy DID — update its details;
 *  2. a row with this email — adopt it, writing the real DID over whatever it
 *     held (this is how a row provisioned before its Privy user existed, or
 *     one whose Privy user was deleted and recreated, gets repaired);
 *  3. provisioning a Teacher while the seeded placeholder Teacher is still
 *     unclaimed — adopt that row, so the seeded Assignment's `teacherId` keeps
 *     pointing at a Teacher who can actually sign in;
 *  4. otherwise insert.
 */
export const provisionUser = internalMutation({
  args: {
    privyDid: v.string(),
    email: v.string(),
    displayName: v.string(),
    role: roleValidator,
  },
  returns: v.object({
    userId: v.id("users"),
    action: provisionActionValidator,
  }),
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const details = {
      privyDid: args.privyDid,
      email,
      displayName: args.displayName,
      role: args.role,
      status: "active" as const,
    };

    const byDid = await ctx.db
      .query("users")
      .withIndex("by_privyDid", (q) => q.eq("privyDid", args.privyDid))
      .unique();
    if (byDid !== null) {
      await ctx.db.patch("users", byDid._id, details);
      return { userId: byDid._id, action: "updated_by_did" as const };
    }

    const byEmail = await findByEmail(ctx, email);
    if (byEmail !== null) {
      await ctx.db.patch("users", byEmail._id, details);
      return { userId: byEmail._id, action: "adopted_by_email" as const };
    }

    if (args.role === "teacher") {
      const seedTeacher = await ctx.db
        .query("users")
        .withIndex("by_privyDid", (q) =>
          q.eq("privyDid", SEED_TEACHER_PRIVY_DID),
        )
        .unique();
      if (seedTeacher !== null) {
        await ctx.db.patch("users", seedTeacher._id, details);
        return {
          userId: seedTeacher._id,
          action: "adopted_seed_teacher" as const,
        };
      }
    }

    const userId: Id<"users"> = await ctx.db.insert("users", details);
    return { userId, action: "created" as const };
  },
});

/**
 * Void an account: flip `status` so every identity lookup stops resolving it.
 *
 * This is only half of voiding. The other half — deleting the Privy user
 * object — happens in `scripts/provision.ts`, because removing the allowlist
 * entry alone does not revoke an existing session and an already-issued access
 * token stays verifiable until it expires. This flip is what closes that
 * window immediately.
 *
 * Returns `null` when no row matches, so the script can still delete the Privy
 * side of a half-provisioned account.
 */
export const voidUser = internalMutation({
  args: { email: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      privyDid: v.string(),
      email: v.string(),
      role: roleValidator,
      alreadyVoided: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await findByEmail(ctx, args.email);
    if (user === null) {
      return null;
    }
    const alreadyVoided = user.status === "voided";
    if (!alreadyVoided) {
      await ctx.db.patch("users", user._id, { status: "voided" });
    }
    return {
      userId: user._id,
      privyDid: user.privyDid,
      email: user.email,
      role: user.role,
      alreadyVoided,
    };
  },
});
