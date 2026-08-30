"use client";

// The backstop boundary for every segment that does not bring its own.
//
// Convex reads throw on an authorization failure by design (build brief), and
// a client-side query is mounted before the caller's role is known — so an
// account that is voided, or a deployment that has lost its configuration row,
// surfaces here rather than as a state the page could render. Without this
// file that throw reaches Next's default error page, which is a stack trace in
// development and an unexplained blank in production.

import Link from "next/link";

export default function AppError({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          This page could not be loaded
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          Viva could not read what it needs to show you. Your sign-in may have
          expired, or your account may no longer be active in this deployment.
          Nothing you have said in a Session is affected — a Transcript is
          written as it happens, not at the end.
        </p>
        <p className="mt-8 flex flex-wrap gap-4">
          <button
            type="button"
            onClick={retry}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
          >
            Try again
          </button>
          <Link
            href="/login"
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
          >
            Sign in
          </Link>
        </p>
      </main>
    </div>
  );
}
