"use client";

// One Session, opened up: the whole Transcript, the whole Assessment, and the
// INV-1 audit of the Examiner's conduct.
//
// Three things this page is careful about.
//
//   Ratings stay words. Established / Partially established / Not established
//   / Not probed, each next to the transcript quotes that support it. There is
//   no count of how many were established, no bar, no share, nothing a reader
//   could average — PRD §8 locks numbers out precisely because numbers become
//   grades.
//
//   The INV-1 flags are an audit of the EXAMINER, not of the Student. A flag
//   means the Examiner supplied a position instead of probing for one. Labelled
//   any less plainly, a Teacher would read them as marks against the Student.
//
//   A failed Assessment says it failed and offers the Grader again. It does not
//   guess at why: the row carries no failure reason, and the honest place for
//   one is the Convex logs. "No Assessment" is a different thing and is not
//   offered the Grader on sight: for the first half-minute after a Session it
//   only means the seal has not run yet, and on a Session that has not ended it
//   means the examination is still happening.

import { useMutation, useQuery } from "convex/react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useGraderStartWindowElapsed } from "../../../../lib/graderWindow";
import {
  END_REASON_LABEL,
  RATING_CLASS,
  RATING_LABEL,
  describeSession,
  formatDuration,
  formatWhen,
  type Rating,
} from "../../../../lib/teacherFormat";

export default function TeacherSessionPage({
  params,
}: PageProps<"/teacher/sessions/[sessionId]">) {
  const { sessionId } = use(params);

  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="w-full max-w-3xl">
        <AuthLoading>
          <p className="text-sm text-zinc-500">Checking your session…</p>
        </AuthLoading>
        <Unauthenticated>
          <SignedOut />
        </Unauthenticated>
        <Authenticated>
          <Gate sessionId={sessionId as Id<"sessions">} />
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

function Gate({ sessionId }: { sessionId: Id<"sessions"> }) {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return <p className="text-sm text-zinc-500">Resolving your account…</p>;
  }
  if (me === null || me.role !== "teacher") {
    return (
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Not available
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Transcripts and Assessments are readable by Teachers.{" "}
          <Link href="/" className="underline underline-offset-4">
            Go back
          </Link>
          .
        </p>
      </section>
    );
  }
  return <SessionDetail sessionId={sessionId} />;
}

function SessionDetail({ sessionId }: { sessionId: Id<"sessions"> }) {
  const detail = useQuery(api.teacher.getSession, { sessionId });
  const assessment = useQuery(api.assessments.getForTeacher, { sessionId });

  if (detail === undefined) {
    return <p className="text-sm text-zinc-500">Loading Session…</p>;
  }
  if (detail === null) {
    return (
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          No such Session
        </h2>
        <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Nothing in this deployment has that id.{" "}
          <Link href="/teacher" className="underline underline-offset-4">
            Back to Sessions
          </Link>
          .
        </p>
      </section>
    );
  }

  const { session, transcript, assignmentPrompt, releaseMode } = detail;

  return (
    <>
      <p className="text-sm">
        <Link
          href="/teacher"
          className="text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
        >
          Back to Sessions
        </Link>
      </p>

      <header className="mt-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {session.studentName}
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {session.assignmentTitle} — version {session.assignmentVersion}
        </p>
        <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Taken" value={formatWhen(session.createdAt)} />
          <Row label="Ran for" value={formatDuration(session.durationSec)} />
          <Row label="Session" value={describeSession(session)} />
          <Row
            label="Counted against caps"
            value={
              session.countsAgainstCaps === null
                ? "not decided yet"
                : session.countsAgainstCaps
                  ? "yes"
                  : "no"
            }
          />
          {session.endReason !== null && (
            <Row label="Ended by" value={END_REASON_LABEL[session.endReason]} />
          )}
          <Row label="Student email" value={session.studentEmail} />
        </dl>
      </header>

      <Section title="Assignment">
        <p className="whitespace-pre-line text-sm leading-7 text-zinc-700 dark:text-zinc-300">
          {assignmentPrompt === ""
            ? "The pinned Assignment version could not be resolved."
            : assignmentPrompt}
        </p>
      </Section>

      <AssessmentSection
        sessionId={sessionId}
        assessment={assessment}
        releaseMode={releaseMode}
        sessionStatus={session.status}
        sessionEndedAt={session.endedAt}
      />

      <Section title="Transcript">
        {transcript.length === 0 ? (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            This Session has no Transcript. It was minted but never produced a
            spoken turn.
          </p>
        ) : (
          <ol className="space-y-5">
            {transcript.map((turn) => (
              <li key={turn.itemId}>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {turn.speaker === "examiner" ? "Examiner" : "Student"}
                </p>
                {turn.text === "" ? (
                  <p className="mt-1 text-sm italic leading-7 text-zinc-500">
                    {turn.textStatus === "truncated"
                      ? "Cut short by the Student speaking over it; the unspoken tail was never produced."
                      : "No text: the transcription of this turn never arrived."}
                  </p>
                ) : (
                  <p className="mt-1 whitespace-pre-line text-sm leading-7 text-zinc-800 dark:text-zinc-200">
                    {turn.text}
                    {turn.textStatus === "truncated" && (
                      <span className="ml-2 text-xs text-zinc-500">
                        (cut short by the Student speaking over it)
                      </span>
                    )}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}

type TeacherAssessment = {
  status: "pending" | "complete" | "failed";
  criteria: { name: string; rating: Rating; evidence: string[] }[] | null;
  formativeSummary: string | null;
  inv1Flags: { quote: string; explanation: string }[] | null;
  graderModel: string | null;
  released: boolean;
  releasedAt: number | null;
};

function AssessmentSection({
  sessionId,
  assessment,
  releaseMode,
  sessionStatus,
  sessionEndedAt,
}: {
  sessionId: Id<"sessions">;
  assessment: TeacherAssessment | null | undefined;
  releaseMode: "shadow" | "auto" | null;
  sessionStatus: "minted" | "live" | "ended";
  sessionEndedAt: number | null;
}) {
  const graderWindowElapsed = useGraderStartWindowElapsed(sessionEndedAt);

  if (assessment === undefined) {
    return (
      <Section title="Assessment">
        <p className="text-sm text-zinc-500">Loading…</p>
      </Section>
    );
  }
  if (assessment === null && sessionStatus !== "ended") {
    return (
      <Section title="Assessment">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {sessionStatus === "live"
            ? "This Session is still running. An Assessment is opened once it ends."
            : "This Session was minted but never started, so there is nothing to assess."}
        </p>
      </Section>
    );
  }
  if (assessment === null && !graderWindowElapsed) {
    return (
      <Section title="Assessment">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          This Session has just ended. The Transcript is given a moment to
          settle before the Grader reads it, so the Assessment does not exist
          yet. This page updates itself when it does.
        </p>
      </Section>
    );
  }
  if (assessment === null) {
    return (
      <Section title="Assessment">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          This Session has no Assessment. A Session that ends with no Transcript
          gets none — there is nothing to evaluate.
        </p>
        <RetryControl sessionId={sessionId} label="Run the Grader" />
      </Section>
    );
  }
  if (assessment.status === "pending") {
    return (
      <Section title="Assessment">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The Grader is running. This page updates itself when it finishes.
        </p>
      </Section>
    );
  }
  if (assessment.status === "failed") {
    return (
      <Section title="Assessment">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The Grader did not produce an Assessment for this Session. The reason
          is in the Convex function logs — the Assessment itself records only
          that it failed. The Transcript is intact, so the Grader can be run
          again against it.
        </p>
        <RetryControl sessionId={sessionId} label="Run the Grader again" />
      </Section>
    );
  }

  const criteria = assessment.criteria ?? [];
  const flags = assessment.inv1Flags ?? [];

  return (
    <>
      <Section title="Assessment">
        <ReleaseControl
          sessionId={sessionId}
          releaseMode={releaseMode}
          released={assessment.released}
          releasedAt={assessment.releasedAt}
        />

        <ul className="mt-8 space-y-8">
          {criteria.map((criterion) => (
            <li key={criterion.name}>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h3 className="text-base font-medium text-black dark:text-zinc-50">
                  {criterion.name}
                </h3>
                <span
                  className={`border-l-2 pl-2 text-xs font-medium uppercase tracking-wide ${RATING_CLASS[criterion.rating]}`}
                >
                  {RATING_LABEL[criterion.rating]}
                </span>
              </div>
              {criterion.evidence.length === 0 ? (
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  {criterion.rating === "not_probed"
                    ? "This Criterion never came up in the Session."
                    : "No transcript evidence was cited for this Criterion."}
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {criterion.evidence.map((quote, index) => (
                    <li
                      key={`${criterion.name}-${index}`}
                      className="border-l-2 border-zinc-300 pl-4 text-sm leading-7 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                    >
                      {quote}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>

        {assessment.formativeSummary !== null && (
          <div className="mt-10 border-t border-zinc-200 pt-6 dark:border-zinc-800">
            <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
              Formative summary
            </h3>
            <p className="mt-3 whitespace-pre-line text-sm leading-7 text-zinc-800 dark:text-zinc-200">
              {assessment.formativeSummary}
            </p>
            <p className="mt-3 text-xs text-zinc-500">
              This is the part the Student reads, alongside their own
              Transcript. The ratings and the audit below are yours alone.
            </p>
          </div>
        )}

        {assessment.graderModel !== null && (
          <p className="mt-6 text-xs text-zinc-500">
            Produced by {assessment.graderModel}.
          </p>
        )}
      </Section>

      <Section title="Examiner audit (INV-1)">
        <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          The Grader audits the Examiner, not the Student. A flag means the
          Examiner supplied a position instead of probing for one — a defect in
          the Examiner&rsquo;s conduct, never a finding about the Student.
        </p>
        {flags.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-700 dark:text-zinc-300">
            No flags. The Examiner questioned throughout.
          </p>
        ) : (
          <ul className="mt-4 space-y-6">
            {flags.map((flag, index) => (
              <li
                key={index}
                className="border-l-2 border-amber-700 pl-4 dark:border-amber-500"
              >
                <p className="text-sm leading-7 text-zinc-800 dark:text-zinc-200">
                  {flag.quote}
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                  {flag.explanation}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/**
 * The shadow-period control (PRD §8).
 *
 * In `auto` there is no control, because there is no decision: the Assessment
 * was released the moment it was created. Showing a disabled button there
 * would suggest a gate that does not exist.
 */
function ReleaseControl({
  sessionId,
  releaseMode,
  released,
  releasedAt,
}: {
  sessionId: Id<"sessions">;
  releaseMode: "shadow" | "auto" | null;
  released: boolean;
  releasedAt: number | null;
}) {
  const release = useMutation(api.assessments.release);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (released) {
    return (
      <p className="border-l-2 border-zinc-400 px-4 py-3 text-sm leading-6 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300">
        {releaseMode === "auto"
          ? "Released to the Student automatically, as this deployment is past its shadow period."
          : "Released to the Student."}
        {releasedAt !== null && ` ${formatWhen(releasedAt)}.`}
      </p>
    );
  }

  return (
    <div className="border-l-2 border-amber-700 px-4 py-3 dark:border-amber-500">
      <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        Not released. The Student cannot see the formative summary yet.
      </p>
      <button
        type="button"
        disabled={working}
        onClick={() => {
          setWorking(true);
          setFailure(null);
          release({ sessionId })
            .catch((error: unknown) =>
              setFailure(
                error instanceof Error
                  ? error.message
                  : "The Assessment could not be released. Try again.",
              ),
            )
            .finally(() => setWorking(false));
        }}
        className="mt-3 rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-black"
      >
        {working ? "Releasing…" : "Release to Student"}
      </button>
      <p className="mt-2 text-xs text-zinc-500">
        One way: a Student who has read their summary cannot un-read it.
      </p>
      {failure !== null && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {failure}
        </p>
      )}
    </div>
  );
}

/**
 * The recourse for an Assessment the Grader could not produce.
 *
 * Offered for a `failed` Assessment, and for one that is genuinely absent on a
 * Session that ended long enough ago for the seal to have run. Not offered
 * while one is `pending`: `assessments.retry` refuses a run that is already in
 * flight, and a button whose only outcome is a refusal is not a recourse.
 */
function RetryControl({
  sessionId,
  label,
}: {
  sessionId: Id<"sessions">;
  label: string;
}) {
  const retry = useMutation(api.assessments.retry);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={working}
        onClick={() => {
          setWorking(true);
          setFailure(null);
          retry({ sessionId })
            .catch((error: unknown) =>
              setFailure(
                error instanceof Error
                  ? error.message
                  : "The Grader could not be started. Try again.",
              ),
            )
            .finally(() => setWorking(false));
        }}
        className="mt-4 rounded border border-zinc-400 px-4 py-2 text-sm font-medium text-zinc-800 disabled:opacity-40 dark:border-zinc-600 dark:text-zinc-200"
      >
        {working ? "Starting…" : label}
      </button>
      {failure !== null && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {failure}
        </p>
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 dark:border-zinc-900">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium text-black dark:text-zinc-50">
        {value}
      </dd>
    </div>
  );
}
