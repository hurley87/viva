"use client";

// The Student's home: the Assignment, one way to start a Session, and the
// Student's own history.
//
// Starting a Session is a mint (CONTEXT.md): the server runs the INV-4 gate —
// monthly breaker, then the Student's day and week caps — before anything
// exists. A refusal is a returned message, not an error, so it is shown here
// as a sentence a Student can act on rather than as a failure.

import { Authenticated, AuthLoading, Unauthenticated, useAction, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { graderStartWindowElapsed } from "../../lib/graderWindow";
import { stashClientSecret } from "../../lib/sessionHandoff";
import {
  describeSession,
  FEEDBACK_STATE_LABEL,
  formatWhen,
  type FeedbackState,
} from "../../lib/sessionText";

export default function StudentPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-2xl">
        <AuthLoading>
          <p className="text-sm text-zinc-500">Checking your session…</p>
        </AuthLoading>
        <Unauthenticated>
          <SignedOut />
        </Unauthenticated>
        <Authenticated>
          <StudentHome />
        </Authenticated>
      </main>
    </div>
  );
}

function SignedOut() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return <p className="text-sm text-zinc-500">Redirecting to sign in…</p>;
}

function StudentHome() {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return <p className="text-sm text-zinc-500">Resolving your account…</p>;
  }
  if (me === null) {
    return (
      <Notice title="Not provisioned">
        You are signed in, but this deployment has no account for you. Viva
        accounts are provisioned by hand; ask your Teacher to have yours
        provisioned, then sign in again.
      </Notice>
    );
  }
  if (me.role !== "student") {
    return (
      <Notice title="Not a Student account">
        This page is for Students. You are signed in as a {me.role}.{" "}
        <Link href="/" className="underline underline-offset-4">
          Go back
        </Link>
        .
      </Notice>
    );
  }
  return <StudentDashboard displayName={me.displayName} />;
}

function StudentDashboard({ displayName }: { displayName: string }) {
  const router = useRouter();
  const assignments = useQuery(api.assignments.listForStudent);
  const sessions = useQuery(api.sessions.mine);
  // Where each past Session's feedback has got to. The state is decided on the
  // server (convex/student.ts) so this list and the Session's own page cannot
  // disagree about whether feedback is ready.
  const feedbackStates = useQuery(api.student.feedbackStates);
  const mintSession = useAction(api.sessions.mintSession);

  const [minting, setMinting] = useState<Id<"assignments"> | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function startSession(assignmentId: Id<"assignments">) {
    setMinting(assignmentId);
    setRefusal(null);
    setFailure(null);
    try {
      const result = await mintSession({ assignmentId });
      if (!result.ok) {
        // A cap or the monthly breaker. Nothing was created; the Student is
        // told what happened and when it clears.
        setRefusal(result.message);
        return;
      }
      stashClientSecret(result.sessionId, result.clientSecret);
      router.push(`/session/${result.sessionId}`);
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "The Session could not be started. Try again in a moment.",
      );
    } finally {
      setMinting(null);
    }
  }

  return (
    <>
      <header className="border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {displayName}
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          A Session is a live spoken examination. The Examiner asks one
          question at a time and presses on what you say. It runs to a fixed
          time-box, counting down on screen from the moment it begins, and you
          are told when the time is nearly up.
        </p>
      </header>

      {refusal !== null && (
        <p
          role="status"
          className="mt-6 border-l-2 border-amber-600 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {refusal}
        </p>
      )}
      {failure !== null && (
        <p
          role="alert"
          className="mt-6 border-l-2 border-red-600 px-4 py-3 text-sm leading-6 text-red-700 dark:text-red-400"
        >
          {failure}
        </p>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Assignment
        </h2>
        {assignments === undefined ? (
          <p className="mt-3 text-sm text-zinc-500">Loading…</p>
        ) : assignments.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            No Assignment has been published yet. Your Teacher publishes one
            before you can take a Session.
          </p>
        ) : (
          <ul className="mt-3 space-y-6">
            {assignments.map((assignment) => (
              <li
                key={assignment.assignmentId}
                className="border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <h3 className="text-lg font-medium text-black dark:text-zinc-50">
                  {assignment.title}
                </h3>
                <p className="mt-3 whitespace-pre-line text-sm leading-7 text-zinc-700 dark:text-zinc-300">
                  {assignment.prompt}
                </p>
                <div className="mt-6 flex items-center gap-4">
                  <button
                    type="button"
                    disabled={minting !== null}
                    onClick={() => void startSession(assignment.assignmentId)}
                    className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-black"
                  >
                    {minting === assignment.assignmentId
                      ? "Starting…"
                      : "Start Session"}
                  </button>
                  <span className="text-xs text-zinc-500">
                    Version {assignment.version}. Your microphone is used for
                    the Session; no audio is stored.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Your Sessions
        </h2>
        {sessions === undefined ? (
          <p className="mt-3 text-sm text-zinc-500">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            You have not taken a Session yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {sessions.map((session) => (
              <li key={session._id}>
                <Link
                  href={`/student/sessions/${session._id}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {session.assignmentTitle}
                  </span>
                  <span className="text-zinc-500 tabular-nums">
                    {formatWhen(session.createdAt)}
                  </span>
                  <span className="w-full text-xs text-zinc-500">
                    {describeSession(session)}
                    {feedbackLabel(feedbackStates, session._id, session.endedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        {children}
      </p>
    </section>
  );
}

/**
 * Where this Session's feedback has got to, appended to the row. Silent while
 * the states are still loading, and for a Session that has not ended — the row
 * already says it is in progress.
 *
 * Also silent for the half-minute after a Session ends. `no_assessment` is the
 * server's answer for both "nothing was recorded" and "the Assessment has not
 * been opened yet", and it is the second one that is true immediately after a
 * Session: the Transcript is sealed on a delay so the Grader never reads a
 * record still being written. Saying nothing for those seconds is better than
 * telling a Student their Session was not assessed and being wrong.
 */
function feedbackLabel(
  states: { sessionId: Id<"sessions">; state: FeedbackState }[] | undefined,
  sessionId: Id<"sessions">,
  endedAt: number | null,
): string {
  const state = states?.find((row) => row.sessionId === sessionId)?.state;
  if (state === undefined) {
    return "";
  }
  if (state === "no_assessment" && !graderStartWindowElapsed(endedAt)) {
    return "";
  }
  const label = FEEDBACK_STATE_LABEL[state];
  return label === null ? "" : ` ${label}.`;
}
