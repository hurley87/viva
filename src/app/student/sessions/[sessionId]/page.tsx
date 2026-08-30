"use client";

// What the Student reads after a Session: their own Transcript, and — once the
// Assessment is released — the formative summary written to them.
//
// The whole page is one Convex query (`api.student.feedbackForSession`), and
// that is deliberate. The Student/Teacher split is a server-side projection
// (PRD §8): per-Criterion ratings, evidence quotes and the INV-1 audit are not
// hidden by this page, they never arrive at this browser. So there is nothing
// here to get wrong — and no state machine of "is it released yet" either,
// because the server decides that too and hands down a single `state`.
//
// The states are separated on purpose. "The Grader is still working",
// "your Teacher has not released it yet", "the Assessment failed" and "there
// was nothing to assess" are four different things that have happened to a
// Student, and collapsing them into one spinner would leave someone who has
// just finished a fifteen-minute oral examination wondering whether the thing
// is broken. Convex queries are reactive, so `pending` resolves into the
// summary on its own with no reload.

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useGraderStartWindowElapsed } from "../../../../lib/graderWindow";
import {
  describeSession,
  formatWhen,
  type FeedbackState,
} from "../../../../lib/sessionText";

export default function StudentSessionPage({
  params,
}: PageProps<"/student/sessions/[sessionId]">) {
  const { sessionId } = use(params);
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-5 py-12 sm:px-6 sm:py-16 dark:bg-black">
      <main className="w-full max-w-2xl">
        <AuthLoading>
          <p className="text-sm text-zinc-500">Checking your session…</p>
        </AuthLoading>
        <Unauthenticated>
          <SignedOut />
        </Unauthenticated>
        <Authenticated>
          <Feedback sessionId={sessionId as Id<"sessions">} />
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

function Feedback({ sessionId }: { sessionId: Id<"sessions"> }) {
  // A Session that is not the caller's own throws here, by design. The error
  // boundary next to this file turns that into a sentence.
  const view = useQuery(api.student.feedbackForSession, { sessionId });

  if (view === undefined) {
    return <p className="text-sm text-zinc-500">Loading your Session…</p>;
  }

  const { session } = view;

  return (
    <>
      <nav className="text-sm">
        <Link
          href="/student"
          className="text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
        >
          Your Sessions
        </Link>
      </nav>

      <header className="mt-6 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight text-black sm:text-3xl dark:text-zinc-50">
          {session.assignmentTitle}
        </h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {formatWhen(session.createdAt)} · Version {session.assignmentVersion}
        </p>
        <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {describeSession(session)}
        </p>
      </header>

      <FeedbackSection
        state={view.state}
        formativeSummary={view.assessment?.formativeSummary ?? null}
        sessionId={sessionId}
        countsAgainstCaps={session.countsAgainstCaps}
        sessionStatus={session.status}
        endedAt={session.endedAt}
      />

      {view.assignmentPrompt.length > 0 && (
        <section className="mt-12">
          <SectionHeading>What you were asked</SectionHeading>
          <p className="mt-3 whitespace-pre-line text-sm leading-7 text-zinc-700 dark:text-zinc-300">
            {view.assignmentPrompt}
          </p>
        </section>
      )}

      <section className="mt-12">
        <SectionHeading>Your Transcript</SectionHeading>
        <Transcript turns={view.transcript} />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// The feedback block — one calm, honest paragraph per state
// ---------------------------------------------------------------------------

function FeedbackSection({
  state,
  formativeSummary,
  sessionId,
  countsAgainstCaps,
  sessionStatus,
  endedAt,
}: {
  state: FeedbackState;
  formativeSummary: string | null;
  sessionId: Id<"sessions">;
  countsAgainstCaps: boolean | null;
  sessionStatus: "minted" | "live" | "ended";
  endedAt: number | null;
}) {
  // `no_assessment` is the server's honest answer to "is there an Assessment
  // row", and for the first half-minute after a Session there is not one yet:
  // the Transcript is sealed on a delay so the Grader never reads a record
  // still being written. Saying "this Session was not assessed" in that window
  // would tell a Student their examination came to nothing seconds after they
  // finished it.
  const graderWindowElapsed = useGraderStartWindowElapsed(endedAt);

  if (state === "released") {
    return (
      <section className="mt-10">
        <SectionHeading>Your feedback</SectionHeading>
        {formativeSummary === null ? (
          <Explanation>
            This Assessment has been released, but its formative summary is not
            available. Your Teacher can run the Assessment again.
          </Explanation>
        ) : (
          <>
            <p className="mt-4 whitespace-pre-line text-base leading-8 text-zinc-900 dark:text-zinc-100">
              {formativeSummary}
            </p>
            <p className="mt-6 text-xs leading-6 text-zinc-500">
              Written from your Transcript against your Teacher&rsquo;s
              Standard. It is formative: it is here to tell you what your
              defense established and where it did not hold.
            </p>
          </>
        )}
      </section>
    );
  }

  if (state === "pending") {
    return (
      <Pending title="Your Assessment is being prepared">
        Your Session has ended and the Grader is working through your
        Transcript. This usually takes a few minutes. You do not need to reload
        this page — your feedback appears here as soon as it is ready. Your
        Transcript is below in the meantime.
      </Pending>
    );
  }

  if (state === "awaiting_release") {
    return (
      <Pending title="Your feedback is not released yet">
        Your Assessment is finished. Your Teacher is reading through the first
        Assessments this Viva produces before they go to Students, so yours
        will arrive shortly rather than immediately. Nothing has gone wrong,
        and nothing is needed from you. Your Transcript is below.
      </Pending>
    );
  }

  if (state === "failed") {
    return (
      <section className="mt-10">
        <SectionHeading>Your Assessment could not be completed</SectionHeading>
        <Explanation>
          Something went wrong while your Transcript was being assessed. The
          Transcript itself is intact and is below, and your Teacher can run
          the Assessment again — nothing you said has been lost.
        </Explanation>
      </section>
    );
  }

  if (state === "no_assessment" && !graderWindowElapsed) {
    return (
      <Pending title="Your Assessment is being prepared">
        Your Session has just ended. Your Transcript is given a moment to
        settle before the Grader reads it, so nothing is assessed while it is
        still being written. Your feedback appears here on its own — you do not
        need to reload. Your Transcript is below in the meantime.
      </Pending>
    );
  }

  if (state === "no_assessment") {
    return (
      <section className="mt-10">
        <SectionHeading>This Session was not assessed</SectionHeading>
        <Explanation>
          Nothing was recorded for this Session, so there was nothing to
          assess. This usually means the connection never established.
          {countsAgainstCaps === false
            ? " It has not counted against your limit."
            : ""}
        </Explanation>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <SectionHeading>This Session has not ended</SectionHeading>
      <Explanation>
        Your feedback appears here once the Session is over.
      </Explanation>
      {sessionStatus === "live" && (
        <p className="mt-4">
          <Link
            href={`/session/${sessionId}`}
            className="inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
          >
            Return to the Session
          </Link>
        </p>
      )}
    </section>
  );
}

function Pending({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      role="status"
      className="mt-10 border-l-2 border-zinc-400 bg-white px-5 py-5 dark:border-zinc-600 dark:bg-zinc-950"
    >
      <h2 className="text-base font-medium text-black dark:text-zinc-50">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
        {children}
      </p>
    </section>
  );
}

function Explanation({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 text-sm leading-7 text-zinc-700 dark:text-zinc-300">
      {children}
    </p>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-medium tracking-wide text-zinc-500 uppercase">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// The Transcript
// ---------------------------------------------------------------------------

type Turn = {
  itemId: string;
  speaker: "student" | "examiner";
  text: string;
  textStatus: "final" | "failed" | "truncated";
};

function Transcript({ turns }: { turns: readonly Turn[] }) {
  if (turns.length === 0) {
    return (
      <Explanation>
        No Transcript was recorded for this Session.
      </Explanation>
    );
  }
  return (
    <ol className="mt-4 space-y-6">
      {turns.map((turn) => (
        <li key={turn.itemId}>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            {turn.speaker === "examiner" ? "Examiner" : "You"}
          </p>
          <TurnText turn={turn} />
        </li>
      ))}
    </ol>
  );
}

/**
 * A turn's text, or the truth about why there isn't any. A Student turn can
 * permanently lack text because the speech-to-text pass failed — a modelled,
 * legal state (ticket #4). Saying so is better than an empty line the Student
 * has to interpret.
 */
function TurnText({ turn }: { turn: Turn }) {
  if (turn.text.length === 0) {
    return (
      <p className="mt-1 text-sm leading-7 text-zinc-500 italic">
        {turn.textStatus === "truncated"
          ? "This turn was cut short before it was transcribed."
          : "This turn was not transcribed."}
      </p>
    );
  }
  return (
    <p className="mt-1 text-base leading-8 whitespace-pre-line text-zinc-900 dark:text-zinc-100">
      {turn.text}
      {turn.textStatus === "truncated" && (
        <span className="text-sm text-zinc-500 italic">
          {turn.speaker === "examiner"
            ? " — cut short when you began speaking."
            : " — cut short."}
        </span>
      )}
    </p>
  );
}
