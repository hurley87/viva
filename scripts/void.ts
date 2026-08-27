import { requireArg } from "./lib/args";
import { convexRun } from "./lib/convex-run";
import {
  deleteUser,
  removeEmailFromAllowlist,
  requirePrivyEnv,
} from "./lib/privy";

type VoidResult = {
  userId: string;
  privyDid: string;
  alreadyVoided: boolean;
};

async function main() {
  const email = requireArg("email").trim().toLowerCase();
  if (!email.includes("@")) {
    throw new Error("Invalid --email");
  }

  const env = requirePrivyEnv();
  const convex = await convexRun<VoidResult>("users:voidInternal", { email });
  await deleteUser(env, convex.privyDid);
  await removeEmailFromAllowlist(env, email);

  console.log(
    JSON.stringify(
      {
        email,
        convexUserId: convex.userId,
        privyDid: convex.privyDid,
        alreadyVoided: convex.alreadyVoided,
        privyUserDeleted: true,
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
