// Presentation vocabulary for the Teacher dashboard.
//
// One module so the list and the detail view cannot drift apart, and so the
// two rules that matter are stated once:
//
//   1. CONTEXT.md words only. Assessment, Criterion, Transcript, Session,
//      Teacher, Student, Examiner, Grader. Never grade, score, mark, or
//      rubric — not in a label, not in a tooltip, not in a status line.
//   2. PRD §8: a Criterion rating is qualitative and stays qualitative.
//      Established / Partially established / Not established / Not probed,
//      rendered as those words. Never a number, a percentage, a count of
//      "how many established", or anything else that could be averaged —
//      numbers get averaged and averages become grades.
//
// The value formatters are re-exported from `./format`, which is also where the
// Student's views get them: one Session has one length, and it must not read
// differently depending on who is looking at it.

export { formatDuration, formatWhen } from "./format";

/** Criterion ratings, exactly as PRD §8 names them. */
export const RATING_LABEL = {
  established: "Established",
  partially_established: "Partially established",
  not_established: "Not established",
  not_probed: "Not probed",
} as const;

export type Rating = keyof typeof RATING_LABEL;

/**
 * Tailwind classes per rating. Colour is a scanning aid, not a scale: the
 * word is always present and is what the Teacher reads.
 */
export const RATING_CLASS: Record<Rating, string> = {
  established:
    "border-emerald-700 text-emerald-800 dark:border-emerald-500 dark:text-emerald-300",
  partially_established:
    "border-amber-700 text-amber-800 dark:border-amber-500 dark:text-amber-300",
  not_established:
    "border-red-700 text-red-800 dark:border-red-500 dark:text-red-300",
  not_probed: "border-zinc-400 text-zinc-600 dark:border-zinc-600 dark:text-zinc-400",
};

/** How a Session ended, in the Teacher's terms rather than the Student's. */
export const END_REASON_LABEL = {
  student_hangup: "Student ended it",
  timebox: "Time-box reached",
  examiner_ended: "Examiner ended it",
  disconnected: "Connection dropped",
} as const;

export type EndReason = keyof typeof END_REASON_LABEL;

export type SessionStatus = "minted" | "live" | "ended";
export type AssessmentStatus = "pending" | "complete" | "failed";

export type AssessmentSummary = {
  status: AssessmentStatus;
  released: boolean;
  releasedAt: number | null;
  criterionCount: number;
  inv1FlagCount: number;
};

/** One line describing where a Session got to. */
export function describeSession(session: {
  status: SessionStatus;
  endReason: EndReason | null;
  countsAgainstCaps: boolean | null;
}): string {
  if (session.status === "minted") {
    return "Minted, never started";
  }
  if (session.status === "live") {
    return "Live";
  }
  const reason =
    session.endReason === null
      ? "Ended"
      : END_REASON_LABEL[session.endReason];
  return session.countsAgainstCaps === false
    ? `${reason} — did not count against caps`
    : reason;
}

/**
 * One line describing where an Assessment got to, including whether it has
 * reached the Student.
 *
 * A `failed` Assessment says only that it failed. There is no failure-reason
 * field on the row — the approved schema has none, and the reason lives in the
 * Convex logs — so inventing a cause here would be inventing a fact.
 */
export function describeAssessment(assessment: AssessmentSummary | null): string {
  if (assessment === null) {
    return "No Assessment";
  }
  switch (assessment.status) {
    case "pending":
      return "Grader running";
    case "failed":
      return "Grader failed";
    case "complete":
      return assessment.released ? "Complete, released" : "Complete, not released";
  }
}
