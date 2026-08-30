// The two value formatters the Student's views and the Teacher's views both
// use, in one module because they had already been written twice and had
// already drifted.
//
// A duration in particular: rounded to whole minutes on the Student's side and
// `M:SS` on the Teacher's, the same Session read as "Ran 2 minutes" to the
// Student and "1:40" to the Teacher, and a Session that dropped after 25
// seconds read as "Ran 0 minutes". Both are the wall-clock length of one
// Session; there is only one true answer and this is where it is computed.
//
// `M:SS` is that answer. A Session is scheduled in minutes but it does not
// always run in them — the interesting ones are the short ones, where the
// difference between 25 seconds and 100 seconds is the whole story — and a
// clock reading never rounds a Session into a length it did not have.

export function formatWhen(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Wall-clock length of a Session, as `M:SS`. `—` where there is none. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}
