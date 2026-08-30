"use client";

// The front door. Signed out, it explains Viva and points at /login. Signed
// in, it routes by role — Student to /student, Teacher to /teacher.
//
// Both of those routes exist, so both roles are redirected straight to their
// own home; nobody's home is this page. The Operator surface is not built, so
// an Operator stays here and is told so. The redirect is what proves the whole
// identity chain end-to-end: Privy session → access token → Convex JWKS
// verification → Privy DID → the `users` row and its role.

import { useQuery } from "convex/react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "../../convex/_generated/api";

/** Where each role lands. `/operator` is out of the MVP surface cut. */
const HOME_ROUTE = {
  student: "/student",
  teacher: "/teacher",
  operator: "/operator",
} as const;

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Viva
        </h1>
        <p className="mt-3 max-w-lg text-base leading-7 text-zinc-600 dark:text-zinc-400">
          A proof-of-understanding layer for education. A Teacher defines an
          Assignment and a private Standard, a Student responds in a live voice
          Session, and the transcript is assessed against that Standard.
        </p>

        <AuthLoading>
          <p className="mt-10 text-sm text-zinc-500">Checking your session…</p>
        </AuthLoading>

        <Unauthenticated>
          <SignedOut />
        </Unauthenticated>

        <Authenticated>
          <SignedIn />
        </Authenticated>
      </main>
    </div>
  );
}

function SignedOut() {
  const readiness = useQuery(api.deployment.readiness);

  return (
    <>
      <p className="mt-10">
        <Link
          href="/login"
          className="inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
        >
          Sign in
        </Link>
      </p>
      <p className="mt-3 text-sm text-zinc-500">
        Accounts are provisioned by hand. There is no sign-up.
      </p>

      <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Backend
        </h2>
        {readiness === undefined ? (
          <p className="mt-3 text-sm text-zinc-500">Connecting to Convex…</p>
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Convex" value="connected" />
            <Row
              label="Deployment configured"
              value={readiness.seeded ? "yes" : "not seeded"}
            />
            <Row label="Assignments" value={String(readiness.assignmentCount)} />
            <Row
              label="Published versions"
              value={String(readiness.publishedVersionCount)}
            />
            <Row label="Release mode" value={readiness.releaseMode} />
          </dl>
        )}
        {readiness !== undefined && !readiness.seeded && (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
            This deployment has no configuration row. Run{" "}
            <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
              npm run seed
            </code>
            .
          </p>
        )}
      </section>
    </>
  );
}

function SignedIn() {
  const { logout } = usePrivy();
  const router = useRouter();
  const me = useQuery(api.users.me);

  // A Student's home is their Assignment and a Teacher's is their Sessions.
  // Neither is this page, so neither stops here.
  const role = me?.role;
  const redirectTo =
    role === "student"
      ? HOME_ROUTE.student
      : role === "teacher"
        ? HOME_ROUTE.teacher
        : null;
  useEffect(() => {
    if (redirectTo !== null) {
      router.replace(redirectTo);
    }
  }, [redirectTo, router]);

  return (
    <section className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      {me === undefined ? (
        <p className="text-sm text-zinc-500">Resolving your account…</p>
      ) : redirectTo !== null ? (
        <p className="text-sm text-zinc-500">
          {role === "teacher"
            ? "Taking you to your Sessions…"
            : "Taking you to your Assignment…"}
        </p>
      ) : me === null ? (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Not provisioned
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            You are signed in, but this deployment has no account for you. Viva
            accounts are provisioned by hand; ask your Teacher to have yours
            provisioned, then sign in again.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Signed in
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Name" value={me.displayName} />
            <Row label="Role" value={me.role} />
          </dl>
          <p className="mt-4 max-w-lg text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {`Your home is ${HOME_ROUTE[me.role]}, which is not built yet.`}
          </p>
        </>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-6 rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
      >
        Sign out
      </button>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 dark:border-zinc-900">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium text-black tabular-nums dark:text-zinc-50">
        {value}
      </dd>
    </div>
  );
}
