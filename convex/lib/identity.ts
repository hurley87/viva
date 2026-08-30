// Caller identity. Every Convex function that is not deliberately public
// resolves its caller through this module — never through a client-supplied
// user id, which a browser can forge freely.
//
// The chain is: Privy access token → Convex verifies it against the app's
// JWKS (see convex/auth.config.ts) → `ctx.auth.getUserIdentity().subject` is
// the Privy DID → the `by_privyDid` index gives the app-level `users` row that
// carries the role. Privy owns authentication; Convex owns the user record.
//
// Two failure vocabularies, deliberately different (per the build brief):
//   - `getUser` returns `null` for "no usable caller" so a read surface can
//     render a signed-in-but-not-provisioned state without an error boundary.
//   - `requireUser` / `requireRole` THROW. Authorization failures are bugs or
//     attacks, never a friendly refusal. (Friendly refusals — caps, breaker —
//     are returned values; see the INV-4 gate in ticket #3.)
//
// A `voided` user is treated exactly as if they had no row at all. Voiding
// also deletes the Privy user object (see scripts/provision.ts) because
// removing an allowlist entry does not revoke an existing session; this check
// is what closes the ≤1h window in which an already-issued access token still
// verifies.
//
// Note on actions: `ctx.auth` exists on an ActionCtx but `ctx.db` does not, so
// these helpers take a query/mutation ctx only. An action authenticates by
// calling an internal mutation or query — auth propagates through
// `ctx.runQuery` / `ctx.runMutation` — which is the pattern ticket #3's mint
// action uses.

import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** A caller's app-level record. Convex owns this; Privy owns only the DID. */
export type User = Doc<"users">;

/** The role union, sourced from the schema so it can never drift. */
export type Role = User["role"];

/** Any context that can both read `ctx.auth` and query the database. */
export type IdentityCtx = QueryCtx | MutationCtx;

const NOT_AUTHENTICATED =
  "Not authenticated: this function requires a signed-in caller.";

const NOT_PROVISIONED =
  "Not provisioned: this account has no Viva user record. Accounts are " +
  "created with the provision script, never by signing in.";

/**
 * The caller's Privy DID (`did:privy:…`), or `null` when the request carried
 * no verified access token.
 */
export async function getPrivyDid(ctx: IdentityCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity === null ? null : identity.subject;
}

/**
 * The caller's user row, or `null` when there is no verified token, no row for
 * the DID, or the row has been voided.
 */
export async function getUser(ctx: IdentityCtx): Promise<User | null> {
  const privyDid = await getPrivyDid(ctx);
  if (privyDid === null) {
    return null;
  }
  const user = await ctx.db
    .query("users")
    .withIndex("by_privyDid", (q) => q.eq("privyDid", privyDid))
    .unique();
  if (user === null || user.status === "voided") {
    return null;
  }
  return user;
}

/**
 * The caller's active user row.
 *
 * @throws when the caller is unauthenticated, unprovisioned, or voided.
 */
export async function requireUser(ctx: IdentityCtx): Promise<User> {
  const privyDid = await getPrivyDid(ctx);
  if (privyDid === null) {
    throw new Error(NOT_AUTHENTICATED);
  }
  const user = await getUser(ctx);
  if (user === null) {
    throw new Error(NOT_PROVISIONED);
  }
  return user;
}

/**
 * The caller's active user row, asserted to hold `role`.
 *
 * @throws when the caller is unauthenticated, unprovisioned, voided, or holds
 * a different role.
 */
export async function requireRole(
  ctx: IdentityCtx,
  role: Role,
): Promise<User> {
  const user = await requireUser(ctx);
  if (user.role !== role) {
    throw new Error(
      `Forbidden: this function is for a ${role}; the caller is a ${user.role}.`,
    );
  }
  return user;
}

/** The caller, asserted to be a Teacher. @throws otherwise. */
export async function requireTeacher(ctx: IdentityCtx): Promise<User> {
  return await requireRole(ctx, "teacher");
}

/** The caller, asserted to be a Student. @throws otherwise. */
export async function requireStudent(ctx: IdentityCtx): Promise<User> {
  return await requireRole(ctx, "student");
}

/** The caller, asserted to be an Operator. @throws otherwise. */
export async function requireOperator(ctx: IdentityCtx): Promise<User> {
  return await requireRole(ctx, "operator");
}
