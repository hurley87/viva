// provision — the one command that creates (or voids) a Viva account.
//
// Provisioning is a three-part write, and all three parts have to happen or the
// account is broken (CONTEXT.md Operations: *provision* creates accounts;
// *mint* is only ever for Sessions):
//
//   1. the Privy user, created ahead of first login so its DID exists before
//      anybody signs in — the Convex schema requires `privyDid` and there is no
//      first-login hook to fill it in later;
//   2. the email on the Privy allowlist, which is what stops a stranger from
//      signing up at all (enforcement happens at Privy, before an account
//      exists);
//   3. the Convex `users` row carrying the role, which is the only place a role
//      is ever stated.
//
// Voiding reverses it: flip the Convex row to `voided` (immediate — every
// Convex function resolves callers through convex/lib/identity.ts, which
// refuses a voided row), remove the allowlist entry, and delete the Privy user
// object. That last step is not optional: Privy's own documentation is explicit
// that removing an allowlist entry does not revoke access for someone who has
// already logged in. Deleting the user object does.
//
// Usage:
//   npm run provision -- --email=ada@example.edu --role=student --name="Ada Lovelace"
//   npm run provision -- --email=ada@example.edu --role=teacher --name="Ada Lovelace"
//   npm run provision -- --email=ada@example.edu --void
//
// Reads PRIVY_APP_ID / PRIVY_APP_SECRET / CONVEX_DEPLOYMENT from .env.local
// (loaded by the npm script). Idempotent: re-running converges.

import { execFileSync } from "node:child_process";
import { PrivyClient } from "@privy-io/node";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const ROLES = ["student", "teacher", "operator"] as const;
type Role = (typeof ROLES)[number];

const USAGE = [
  "Usage:",
  '  npm run provision -- --email=<address> --role=<student|teacher|operator> --name="<display name>"',
  "  npm run provision -- --email=<address> --void",
].join("\n");

type Args = {
  email: string;
  role: Role | null;
  name: string | null;
  void: boolean;
};

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      fail(`Unrecognized argument: ${arg}`);
    }
    const [key, ...rest] = arg.slice(2).split("=");
    flags.set(key, rest.join("="));
  }

  const email = (flags.get("email") ?? "").trim().toLowerCase();
  if (email === "" || !email.includes("@")) {
    fail("--email=<address> is required.");
  }

  const isVoid = flags.has("void");
  const rawRole = flags.get("role");
  let role: Role | null = null;
  if (rawRole !== undefined && rawRole !== "") {
    if (!(ROLES as readonly string[]).includes(rawRole)) {
      fail(`--role must be one of ${ROLES.join(", ")}; got "${rawRole}".`);
    }
    role = rawRole as Role;
  }

  const name = flags.get("name")?.trim() ?? null;

  if (!isVoid) {
    if (role === null) {
      fail(`--role=<${ROLES.join("|")}> is required when provisioning.`);
    }
    if (name === null || name === "") {
      fail('--name="<display name>" is required when provisioning.');
    }
  }

  return { email, role, name, void: isVoid };
}

function fail(message: string): never {
  console.error(`provision: ${message}\n\n${USAGE}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    fail(
      `${name} is not set. It belongs in .env.local, which the npm script loads.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Convex
// ---------------------------------------------------------------------------

/**
 * Call a Convex *internal* function through the CLI.
 *
 * The provisioning mutations are internal on purpose — nothing a browser can
 * reach may write a role — so they are unreachable from a normal Convex client.
 * `npx convex run` authenticates with the deployment admin credentials the CLI
 * already holds, which is exactly the privilege level an operator script wants.
 */
function convexRun(functionName: string, args: unknown): unknown {
  const stdout = execFileSync(
    "npx",
    ["convex", "run", functionName, JSON.stringify(args)],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  const trimmed = stdout.trim();
  if (trimmed === "" || trimmed === "null") {
    return null;
  }
  return JSON.parse(trimmed);
}

type ProvisionResult = {
  userId: string;
  action:
    | "created"
    | "updated_by_did"
    | "adopted_by_email"
    | "adopted_seed_teacher";
};

type VoidResult = {
  userId: string;
  privyDid: string;
  email: string;
  role: Role;
  alreadyVoided: boolean;
} | null;

/** How the Convex row was reached, in words an operator can act on. */
const ACTION_NOTE: Record<ProvisionResult["action"], string> = {
  created: "inserted a new row",
  updated_by_did: "updated the existing row for this Privy DID",
  adopted_by_email: "adopted the existing row with this email",
  adopted_seed_teacher:
    "adopted the seeded placeholder Teacher row, so the seeded Assignment now belongs to a Teacher who can sign in",
};

// ---------------------------------------------------------------------------
// Privy
// ---------------------------------------------------------------------------

function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  return status === 404;
}

/** The Privy DID for this email, creating the Privy user if it has none. */
async function resolvePrivyUser(
  privy: PrivyClient,
  email: string,
): Promise<{ did: string; created: boolean }> {
  try {
    const existing = await privy.users().getByEmailAddress({ address: email });
    return { did: existing.id, created: false };
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  // No `wallets` field: omitting it is what keeps Privy from creating an
  // embedded wallet Viva would never use.
  const created = await privy.users().create({
    linked_accounts: [{ type: "email", address: email }],
  });
  return { did: created.id, created: true };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const appId = requireEnv("PRIVY_APP_ID");
  const privy = new PrivyClient({
    appId,
    appSecret: requireEnv("PRIVY_APP_SECRET"),
  });

  // The allowlist is the stranger-blocking mechanism, and Privy refuses
  // allowlist writes while the app-level toggle is off. Say so loudly rather
  // than provisioning an account that anyone could then sign up alongside.
  const settings = await privy.apps().getSettings();
  if (settings.allowlist_enabled !== true) {
    fail(
      "the Privy app's allowlist is disabled, so allowlist writes will fail and " +
        "any email could sign up. Enable it (Dashboard > Users > Access control) " +
        "before provisioning. See the README.",
    );
  }

  const allowlist = await privy.apps().getAllowlist();
  const allowlisted = allowlist.some(
    (entry) =>
      entry.type === "email" && entry.value.toLowerCase() === args.email,
  );

  if (args.void) {
    await voidAccount(privy, args.email, allowlisted);
    return;
  }

  // 1. Privy user ---------------------------------------------------------
  const { did, created } = await resolvePrivyUser(privy, args.email);

  // 2. Allowlist ----------------------------------------------------------
  if (!allowlisted) {
    await privy.apps().inviteToAllowlist({ type: "email", value: args.email });
  }

  // 3. Convex row ---------------------------------------------------------
  const result = convexRun("internal.users.provisionUser", {
    privyDid: did,
    email: args.email,
    displayName: args.name,
    role: args.role,
  }) as ProvisionResult;

  console.log(
    [
      `Provisioned ${args.role}: ${args.name} <${args.email}>`,
      `  Privy user  ${did} (${created ? "created" : "already existed"})`,
      `  Allowlist   ${allowlisted ? "already present" : "added"}`,
      `  Convex row  ${result.userId} — ${ACTION_NOTE[result.action]}`,
      "",
      "They can now sign in at /login with a one-time code sent to that address.",
    ].join("\n"),
  );
}

async function voidAccount(
  privy: PrivyClient,
  email: string,
  allowlisted: boolean,
): Promise<void> {
  // Convex first: the flip takes effect on the very next function call, while
  // the Privy deletion only stops *new* tokens being issued.
  const row = convexRun("internal.users.voidUser", { email }) as VoidResult;

  if (allowlisted) {
    await privy.apps().removeFromAllowlist({ type: "email", value: email });
  }

  // Prefer the DID Convex recorded; fall back to a lookup for an account whose
  // Convex row never landed.
  let did = row?.privyDid ?? null;
  if (did === null) {
    try {
      did = (await privy.users().getByEmailAddress({ address: email })).id;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  let privyNote = "no Privy user found";
  if (did !== null) {
    try {
      await privy.users().delete(did);
      privyNote = `deleted ${did}`;
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      privyNote = `already deleted (${did})`;
    }
  }

  console.log(
    [
      `Voided <${email}>`,
      `  Convex row  ${
        row === null
          ? "none found"
          : row.alreadyVoided
            ? `${row.userId} — already voided`
            : `${row.userId} — status flipped to voided`
      }`,
      `  Allowlist   ${allowlisted ? "entry removed" : "no entry"}`,
      `  Privy user  ${privyNote}`,
      "",
      "Convex refuses this caller immediately; any access token already issued",
      "can no longer be refreshed and expires within the hour.",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error("provision failed:", error);
  process.exit(1);
});
