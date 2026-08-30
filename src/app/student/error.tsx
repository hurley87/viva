"use client";

// A Student's home mounts `assignments.listForStudent`, `sessions.mine` and
// `student.feedbackStates` as soon as the caller is authenticated, and all
// three go through `requireStudent`. So an account that is voided — or was
// never provisioned — while the tab is open makes every one of them throw
// before `users.me` re-resolves to `null` and the page's own "Not provisioned"
// notice can take over. This turns that race into a sentence.

import Link from "next/link";

export default function StudentError({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Your Assignment is not available
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          This page is readable by an active Student account. Yours may not be
          provisioned in this deployment, or your sign-in may have expired.
          Viva accounts are provisioned by hand; ask your Teacher to have yours
          provisioned, then sign in again.
        </p>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          Sessions you have already taken are unaffected. Nothing is lost by
          this page failing to load.
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
