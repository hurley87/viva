// Time-box window math. Every value here is derived from the SERVER clock —
// a Session's `startedAt` is stamped by `sessions.start` on the backend and
// nothing a browser reports is ever used to decide when a Session ends.
//
// The client countdown is UX. Enforcement is: the scheduled hangup job, and
// the server refusing to accept material past the cutoff (INV-4 build note).

import { TIMEBOX_GRACE_SEC, TIMEBOX_HANGUP_GRACE_SEC } from "./constants";

const MS_PER_SEC = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SEC;

/** Milliseconds in a rolling 24-hour cap window. */
export const DAY_WINDOW_MS = 24 * 60 * MS_PER_MINUTE;

/** Milliseconds in a rolling 7-day cap window. */
export const WEEK_WINDOW_MS = 7 * DAY_WINDOW_MS;

/**
 * The instant a Session must be over: `startedAt + timeboxSec`. A Session
 * that never started has no cutoff, so this returns `null` — callers must
 * decide what an unstarted Session means rather than getting a silent zero.
 */
export function timeboxCutoffAt(
  startedAt: number | undefined,
  timeboxSec: number,
): number | null {
  if (startedAt === undefined) {
    return null;
  }
  return startedAt + timeboxSec * MS_PER_SEC;
}

/**
 * The instant the server severs the call: the cutoff plus
 * {@link TIMEBOX_HANGUP_GRACE_SEC}.
 *
 * The time-box is the cutoff; this is when the server stops waiting for the
 * Examiner to close things gracefully and hangs up regardless. Returns `null`
 * for a Session that never started, exactly as {@link timeboxCutoffAt} does.
 */
export function timeboxHangupAt(
  startedAt: number | undefined,
  timeboxSec: number,
): number | null {
  const cutoff = timeboxCutoffAt(startedAt, timeboxSec);
  return cutoff === null ? null : cutoff + TIMEBOX_HANGUP_GRACE_SEC * MS_PER_SEC;
}

/**
 * The last instant the server will accept material for a Session: the cutoff
 * plus {@link TIMEBOX_GRACE_SEC}, which covers the one in-flight write from a
 * client that was mid-request when the time-box expired. Deliberately later
 * than {@link timeboxHangupAt}, so the Examiner's closing turn is still
 * persistable.
 */
export function writeCutoffAt(
  startedAt: number | undefined,
  timeboxSec: number,
): number | null {
  const cutoff = timeboxCutoffAt(startedAt, timeboxSec);
  return cutoff === null ? null : cutoff + TIMEBOX_GRACE_SEC * MS_PER_SEC;
}

/**
 * Whether `now` is past the point where material may still be persisted or
 * graded for a Session started at `startedAt`. An unstarted Session is past
 * nothing — it has produced no material at all.
 */
export function isPastWriteCutoff(
  now: number,
  startedAt: number | undefined,
  timeboxSec: number,
): boolean {
  const cutoff = writeCutoffAt(startedAt, timeboxSec);
  return cutoff !== null && now > cutoff;
}

/**
 * Wall-clock seconds a Session actually ran. A Session that never connected
 * ran for zero seconds, which is what makes the forgiveness floor treat it as
 * not counting against the caps.
 */
export function durationSec(
  startedAt: number | undefined,
  endedAt: number,
): number {
  if (startedAt === undefined) {
    return 0;
  }
  return Math.max(0, (endedAt - startedAt) / MS_PER_SEC);
}

/**
 * INV-4 edge (a): a Session shorter than the forgiveness floor — a network
 * drop, a mic that never worked — ended, but does not burn one of the
 * Student's attempts.
 */
export function countsAgainstCaps(
  durationInSec: number,
  minDurationSec: number,
): boolean {
  return durationInSec >= minDurationSec;
}

/**
 * The first instant of the current calendar month in UTC. The breaker sums
 * one calendar month of spend; UTC is chosen so the boundary is a single
 * fixed instant for every deployment rather than a function of where the
 * caller happens to be.
 */
export function startOfCalendarMonthUtc(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
}

/** Format seconds as `M:SS` for server-side messages. */
export function formatSeconds(totalSec: number): string {
  const whole = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
