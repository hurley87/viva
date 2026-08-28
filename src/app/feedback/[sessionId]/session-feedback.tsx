"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { api } from "../../../../convex/_generated/api";
import {
  SignedInStudent,
  StudentResourceGate,
} from "@/components/signed-in-student";
import { studentEndReasonCopy } from "@/lib/student-end-reason";

function speakerLabel(speaker: "student" | "examiner"): string {
  switch (speaker) {
    case "student":
      return "You";
    case "examiner":
      return "Examiner";
    default: {
      const exhaustive: never = speaker;
      return exhaustive;
    }
  }
}

function turnDisplayText(turn: {
  text: string;
  textStatus: "final" | "failed" | "truncated";
}): string {
  if (turn.textStatus === "failed") {
    return "Speech was not captured.";
  }
  if (turn.text.length === 0 && turn.textStatus === "truncated") {
    return "This turn was cut off.";
  }
  return turn.text;
}

export function SessionFeedback({ sessionId }: { sessionId: string }) {
  return (
    <SignedInStudent
      title="Feedback"
      loadingCopy="Loading feedback…"
      signedOutCopy="Sign in as a Student to see your transcript and feedback."
      wrongRoleCopy="Session feedback is shown to the Student who took the Session."
    >
      <SessionFeedbackForStudent sessionId={sessionId} />
    </SignedInStudent>
  );
}

function SessionFeedbackForStudent({ sessionId }: { sessionId: string }) {
  const view = useQuery(api.studentFeedback.getMine, { sessionId });

  return (
    <StudentResourceGate
      title="Feedback"
      loadingCopy="Loading feedback…"
      notFoundCopy="This Session was not found, or it does not belong to you."
      notFoundHref="/feedback"
      notFoundHrefLabel="Your Sessions"
      resource={view}
    >
      {(loaded) => <SessionFeedbackBody view={loaded} />}
    </StudentResourceGate>
  );
}

function SessionFeedbackBody({
  view,
}: {
  view: NonNullable<FunctionReturnType<typeof api.studentFeedback.getMine>>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-12">
      <div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Session</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {view.assignmentTitle}
        </h1>
        {view.status === "ended" && view.endReason ? (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            {studentEndReasonCopy(view.endReason)}
          </p>
        ) : null}
        {view.status !== "ended" ? (
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            This Session is still in progress.{" "}
            <Link className="underline" href={`/session/${view.sessionId}`}>
              Return to the live Session
            </Link>
            .
          </p>
        ) : null}
      </div>

      {view.feedback.state === "released" ? (
        <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Formative feedback
          </h2>
          <p className="whitespace-pre-wrap leading-7">
            {view.feedback.formativeSummary}
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
          <h2 className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Feedback pending
          </h2>
          <p className="leading-7 text-zinc-700 dark:text-zinc-300">
            Your transcript is ready. Formative feedback will appear here once
            the Assessment is released.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Your transcript
        </h2>
        {view.transcript.length === 0 ? (
          <p className="text-zinc-500">No transcript turns were captured.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {view.transcript.map((turn, index) => (
              <li key={`${index}-${turn.speaker}`} className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {speakerLabel(turn.speaker)}
                </span>
                <p
                  className={
                    turn.textStatus === "final"
                      ? "leading-6"
                      : "leading-6 text-zinc-500 italic"
                  }
                >
                  {turnDisplayText(turn)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <Link className="text-sm underline" href="/feedback">
          Your Sessions
        </Link>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </div>
    </main>
  );
}
