import { requireArg } from "./lib/args";
import { convexRun } from "./lib/convex-run";
import {
  addEmailToAllowlist,
  createUser,
  getUserByEmail,
  requirePrivyEnv,
} from "./lib/privy";

const ROLES = ["teacher", "student", "operator"] as const;
type Role = (typeof ROLES)[number];

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

type ProvisionResult = {
  userId: string;
  created: boolean;
};

async function resolvePrivyDid(
  env: ReturnType<typeof requirePrivyEnv>,
  email: string,
): Promise<{ privyDid: string; createdPrivyUser: boolean }> {
  const existing = await getUserByEmail(env, email);
  if (existing?.id) {
    return { privyDid: existing.id, createdPrivyUser: false };
  }

  const created = await createUser(env, email);
  if (!created.id) {
    throw new Error("Privy create user returned no id");
  }
  return { privyDid: created.id, createdPrivyUser: true };
}

async function main() {
  const email = requireArg("email").trim().toLowerCase();
  const role = requireArg("role");
  const displayName = requireArg("displayName").trim();

  if (!email.includes("@")) {
    throw new Error("Invalid --email");
  }
  if (!isRole(role)) {
    throw new Error(`Invalid --role (expected ${ROLES.join("|")})`);
  }
  if (displayName.length === 0) {
    throw new Error("Invalid --displayName");
  }

  const env = requirePrivyEnv();
  const { privyDid, createdPrivyUser } = await resolvePrivyDid(env, email);
  await addEmailToAllowlist(env, email);
  const convex = await convexRun<ProvisionResult>("users:provisionInternal", {
    privyDid,
    email,
    displayName,
    role,
  });

  console.log(
    JSON.stringify(
      {
        email,
        role,
        displayName,
        privyDid,
        createdPrivyUser,
        convexUserId: convex.userId,
        createdConvexUser: convex.created,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
