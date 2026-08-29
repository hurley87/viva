// Shared server-side constants. Everything here is deployment-wide and not
// Teacher-configurable; the Teacher-tunable values live in the
// `deploymentConfig` singleton (see convex/lib/config.ts).

/**
 * Transcript writes and grading are accepted this far past the time-box
 * cutoff, measured on the server clock. Covers the last in-flight item from a
 * client that was mid-write when the Session ended (INV-4 build note: the
 * server refuses to persist or grade content past the cutoff).
 */
export const TIMEBOX_GRACE_SEC = 20;

/**
 * Slack added to the mint-time backstop timer. At mint we schedule the
 * time-box enforcement job at `timeboxSec + CONNECT_GRACE_SEC` so that a
 * client which never completes the WebRTC connection is still cleaned up;
 * once the browser reports the call id, `sessions.start` reschedules from the
 * real start time.
 */
export const CONNECT_GRACE_SEC = 120;

/**
 * PLACEHOLDER estimate of OpenAI Realtime spend per wall-clock minute of a
 * Session, in USD, counting audio in both directions plus text. Used to write
 * a `realtime` spendEvent at Session end so the INV-4 monthly breaker has
 * something to sum.
 *
 * This number is deliberately conservative (it should over-estimate, so the
 * breaker trips early rather than late). The real arithmetic — per-Session
 * and per-Student-week cost, validated against the $5K grant — is the open
 * cost-model ticket: `.scratch/viva-mvp/issues/08-cost-model.md`. Replace this
 * constant when that ticket lands.
 */
export const REALTIME_USD_PER_MINUTE = 0.3;
