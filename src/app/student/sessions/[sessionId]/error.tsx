"use client";

// A Session id that is not the caller's own — a pasted link, a stale bookmark,
// a Teacher signed in on the Student route — makes the Convex read throw. That
// is an authorization failure, which throws by design (PRD §6: a Student reads
// their own Sessions and nobody else's); this turns it into a sentence.

import Link from "next/link";

export default function StudentSessionError({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-5 py-24 sm:px-6 dark:bg-black">
      <main className="w-full max-w-2xl">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          This Session is not available
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          It may belong to somebody else, or the link may be wrong. You can
          only open your own Sessions.
        </p>
        <p className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/student"
            className="inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
          >
            Back to your Sessions
          </Link>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200"
          >
            Try again
          </button>
        </p>
      </main>
    </div>
  );
}
