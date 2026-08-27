"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";

function formatEndedAt(endedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(endedAt);
}

export function FeedbackList() {
  const me = useQuery(api.users.me);
  const sessions = useQuery(
    api.studentFeedback.listMine,
    me?.role === "student" ? {} : "skip",
  );

  if (me === undefined || (me?.role === "student" && sessions === undefined)) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <p>Loading Sessions…</p>
      </main>
    );
  }

  if (me === null) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Your Sessions</h1>
        <p>Sign in as a Student to see your transcript and feedback.</p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  if (me.role !== "student") {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Your Sessions</h1>
        <p>Session feedback is shown to the Student who took the Session.</p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your Sessions</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          After each Session you can reread your transcript. Formative feedback
          appears once the Assessment is released.
        </p>
      </div>

      {sessions === undefined || sessions.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No ended Sessions yet.{" "}
          <Link className="underline" href="/">
            Start a Session
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.sessionId}>
              <Link
                href={`/feedback/${session.sessionId}`}
                className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <span className="font-medium">{session.assignmentTitle}</span>
                {session.endedAt !== undefined ? (
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">
                    {formatEndedAt(session.endedAt)}
                  </span>
                ) : null}
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {session.feedbackState === "released"
                    ? "Formative feedback ready"
                    : "Feedback pending"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link className="text-sm underline" href="/">
        Back home
      </Link>
    </main>
  );
}
