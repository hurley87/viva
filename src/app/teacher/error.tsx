"use client";

// The dashboard's reads throw for anyone who is not an active Teacher, which
// is the point — authorization failures throw by design (build brief). Both
// pages check the caller's role before mounting a query, so this boundary is
// the backstop for the cases they cannot pre-empt: an account voided while the
// tab was open, a malformed Session id in a pasted link, a deployment that
// lost its configuration row.

import Link from "next/link";

export default function TeacherError({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          This dashboard is not available
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          Transcripts and Assessments are readable by Teachers. If you are one,
          the link may be wrong or your session may have expired — sign in again
          and try once more.
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
            href="/teacher"
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
          >
            Back to Sessions
          </Link>
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
