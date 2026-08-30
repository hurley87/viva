// The gap between a Session ending and its Assessment existing.
//
// `finalizeSession` does not open the Assessment at the end of a Session: it
// schedules `sealSession` SEAL_DELAY_SEC later, because the server keeps
// accepting Transcript writes for a grace past the end and the Grader must not
// read a record that is still being written (convex/lib/constants.ts).
//
// So for about half a minute after every Session there is no `assessments` row
// at all — and "there is no Assessment" is the same shape on the wire as "this
// Session produced nothing to assess". A surface that cannot tell them apart
// tells a Student their Session was not assessed seconds after they finished
// it, and offers a Teacher a Grader re-run that `assessments.retry` will refuse.
// This is how both tell them apart: by the clock, from the Session's own
// `endedAt`.

import { useEffect, useState } from "react";
import { SEAL_DELAY_SEC } from "../../convex/lib/constants";

/**
 * How long after a Session ends an absent Assessment still means "not opened
 * yet" rather than "never coming". The seal delay itself plus slack for the
 * scheduler: being a little late to call it absent costs a sentence, being
 * early makes that sentence wrong.
 */
export const GRADER_START_WINDOW_MS = (SEAL_DELAY_SEC + 10) * 1000;

/** Whether {@link GRADER_START_WINDOW_MS} has passed since `endedAt`. */
export function graderStartWindowElapsed(
  endedAt: number | null,
  now: number = Date.now(),
): boolean {
  return endedAt === null || now >= endedAt + GRADER_START_WINDOW_MS;
}

/**
 * The same question, as a hook that re-renders once when the answer changes.
 *
 * The answer itself is derived at render time rather than held in state, so it
 * is never stale; the effect exists only to schedule the single re-render at
 * the moment the window closes. Convex queries are reactive, so the ordinary
 * case resolves itself — the Assessment row appears and the view re-renders
 * around it. The timer is for the case where no row is ever coming (a Session
 * with no Transcript), which would otherwise sit on "the Grader is starting"
 * for as long as the tab is open.
 */
export function useGraderStartWindowElapsed(endedAt: number | null): boolean {
  const [, bumpTick] = useState(0);

  useEffect(() => {
    if (endedAt === null) {
      return;
    }
    const remainingMs = endedAt + GRADER_START_WINDOW_MS - Date.now();
    if (remainingMs <= 0) {
      return;
    }
    const timer = window.setTimeout(
      () => bumpTick((tick) => tick + 1),
      remainingMs,
    );
    return () => window.clearTimeout(timer);
  }, [endedAt]);

  return graderStartWindowElapsed(endedAt);
}
