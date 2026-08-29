// The sentences the Student reads about their own Sessions, in one place so
// the list on /student and the feedback view for one Session cannot drift into
// describing the same Session two different ways.
//
// Vocabulary is CONTEXT.md's: Session, Transcript, Assessment, Examiner,
// Grader. Never "grade", "score", "result", or "attempt".

/** A Session's `endReason`, as the Student's own account of what happened. */
export const END_REASON_TEXT = {
  student_hangup: "you ended it",
  timebox: "time ran out",
  examiner_ended: "the Examiner ended it",
  disconnected: "the connection dropped",
} as const;

export type EndReason = keyof typeof END_REASON_TEXT;

/** How far along a Session's feedback is. Mirrors `convex/student.ts`. */
export type FeedbackState =
  | "session_not_ended"
  | "no_assessment"
  | "pending"
  | "awaiting_release"
  | "failed"
  | "released";

/**
 * The one-line version, for a row in a list. `null` where there is nothing
 * worth saying — a Session still in progress says so on its own.
 */
export const FEEDBACK_STATE_LABEL: Record<FeedbackState, string | null> = {
  session_not_ended: null,
  no_assessment: "Not assessed",
  pending: "Feedback being prepared",
  awaiting_release: "Feedback not released yet",
  failed: "Assessment could not be completed",
  released: "Feedback ready",
};

export function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Whole minutes, rounded. A Session is scheduled in minutes, not seconds. */
export function formatDuration(totalSec: number): string {
  const minutes = Math.round(totalSec / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export type SessionShape = {
  status: "minted" | "live" | "ended";
  durationSec: number | null;
  endReason: EndReason | null;
  countsAgainstCaps: boolean | null;
};

/** What became of one Session, in a sentence. */
export function describeSession(session: SessionShape): string {
  if (session.status === "minted") {
    return "Not started.";
  }
  if (session.status === "live") {
    return "In progress.";
  }
  const parts: string[] = [];
  if (session.durationSec !== null) {
    parts.push(`Ran ${formatDuration(session.durationSec)}`);
  }
  if (session.endReason !== null) {
    parts.push(END_REASON_TEXT[session.endReason]);
  }
  if (session.countsAgainstCaps === false) {
    parts.push("too short to count against your limit");
  }
  return `${parts.join(" — ")}.`;
}
