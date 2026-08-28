"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import {
  assessmentStatusLabel,
  buttonClassName,
  endReasonLabel,
  formatWhen,
  ratingClassName,
  ratingLabel,
  sessionStatusLabel,
  speakerLabel,
} from "./copy";

export function TeacherSessionDetail({ sessionId }: { sessionId: string }) {
  const detail = useQuery(api.teacher.getSession, { sessionId });
  const release = useMutation(api.assessments.release);
  const retry = useMutation(api.assessments.retry);
  const [error, setError] = useState<string | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  if (detail === null) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Session</h1>
        <p>This Session was not found.</p>
        <Link href="/teacher" className="text-sm underline">
          Back to dashboard
        </Link>
      </>
    );
  }

  if (detail === undefined) {
    return <p>Loading Session…</p>;
  }

  const { session, transcript, assessment, releaseMode } = detail;
  const canRelease =
    releaseMode === "shadow" &&
    assessment?.status === "complete" &&
    !assessment.released;

  async function handleRelease() {
    if (!assessment) {
      return;
    }
    setError(null);
    setIsReleasing(true);
    try {
      await release({ assessmentId: assessment._id });
    } catch (releaseError) {
      setError(
        releaseError instanceof Error
          ? releaseError.message
          : String(releaseError),
      );
    } finally {
      setIsReleasing(false);
    }
  }

  async function handleRetry() {
    if (!assessment) {
      return;
    }
    setError(null);
    setIsRetrying(true);
    try {
      await retry({ assessmentId: assessment._id });
    } catch (retryError) {
      setError(
        retryError instanceof Error ? retryError.message : String(retryError),
      );
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <>
      <p>
        <Link href="/teacher" className="text-sm underline">
          Back to dashboard
        </Link>
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {session.studentDisplayName}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {session.studentEmail}
        </p>
        <p className="font-medium">{session.assignmentTitle}</p>
        {session.assignmentPrompt ? (
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {session.assignmentPrompt}
          </p>
        ) : null}
        <p className="text-sm">
          {sessionStatusLabel(session.status)}
          {session.endReason ? ` · ${endReasonLabel(session.endReason)}` : ""}
        </p>
        <p className="text-xs text-zinc-500">
          Started {formatWhen(session.startedAt)}
          {session.endedAt ? ` · Ended ${formatWhen(session.endedAt)}` : ""}
        </p>
      </div>

      {releaseMode === "shadow" ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <h2 className="text-sm font-semibold">Shadow period</h2>
          <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
            This Assessment is held for Teacher review. Release it to the
            Student when the Grader output looks right.
          </p>
          {canRelease ? (
            <button
              type="button"
              className={`${buttonClassName} mt-3`}
              disabled={isReleasing}
              onClick={() => void handleRelease()}
            >
              {isReleasing ? "Releasing…" : "Release to Student"}
            </button>
          ) : assessment?.released ? (
            <p className="mt-2 text-sm">Released to the Student.</p>
          ) : (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Release is available once the Assessment is complete.
            </p>
          )}
        </section>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Auto-release is on. Complete Assessments reach the Student without a
          Teacher action.
        </p>
      )}

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Transcript</h2>
        {transcript.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No transcript items yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {transcript.map((turn, index) => (
              <li
                key={`${turn.speaker}-${index}`}
                className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {speakerLabel(turn.speaker)}
                  {turn.textStatus !== "final" ? ` · ${turn.textStatus}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                  {turn.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Assessment</h2>
        {assessment === null ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No Assessment yet. The Grader runs after the Session ends.
          </p>
        ) : (
          <>
            <p className="text-sm">
              {assessmentStatusLabel(assessment.status)}
              {assessment.released ? " · Released" : " · Not released"}
              {assessment.graderModel
                ? ` · ${assessment.graderModel}`
                : ""}
            </p>
            {assessment.status === "failed" ? (
              <button
                type="button"
                className={buttonClassName}
                disabled={isRetrying}
                onClick={() => void handleRetry()}
              >
                {isRetrying ? "Retrying…" : "Retry Grader"}
              </button>
            ) : null}
            {assessment.criteria && assessment.criteria.length > 0 ? (
              <ul className="flex flex-col gap-4">
                {assessment.criteria.map((criterion) => (
                  <li
                    key={criterion.name}
                    className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                      <h3 className="font-medium">{criterion.name}</h3>
                      <p
                        className={`text-sm font-medium ${ratingClassName(criterion.rating)}`}
                      >
                        {ratingLabel(criterion.rating)}
                      </p>
                    </div>
                    {criterion.evidence.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-2">
                        {criterion.evidence.map((quote, evidenceIndex) => (
                          <li
                            key={`${criterion.name}-evidence-${evidenceIndex}`}
                            className="border-l-2 border-zinc-300 pl-3 text-sm leading-6 text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
                          >
                            “{quote}”
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-zinc-500">
                        No evidence quotes.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {assessment.formativeSummary ? (
              <div>
                <h3 className="text-sm font-semibold">Formative summary</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {assessment.formativeSummary}
                </p>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">INV-1 flags</h2>
        {assessment?.inv1Flags && assessment.inv1Flags.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {assessment.inv1Flags.map((flag, flagIndex) => (
              <li
                key={`inv1-${flagIndex}`}
                className="rounded-md border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40"
              >
                <p className="text-sm leading-6">“{flag.quote}”</p>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {flag.explanation}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No INV-1 flags on this Assessment.
          </p>
        )}
      </section>
    </>
  );
}
