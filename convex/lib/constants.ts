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
 * How long past the time-box the scheduled server hangup waits before severing
 * the call.
 *
 * The time-box is a hard stop, but the shape the Examiner prompt asks for is a
 * graceful one: at `[SYSTEM: time is up]` it says one closing sentence and
 * calls `end_session`. Hanging up at exactly `startedAt + timeboxSec` makes
 * that closing line unreachable — every expiring Session would end with audio
 * cut mid-sentence. This grace is the window in which the graceful path can
 * actually happen; it is deliberately shorter than {@link TIMEBOX_GRACE_SEC},
 * so the closing turn is still inside the window in which the server accepts
 * Transcript writes.
 *
 * It is not slack in the time-box: the Examiner is told the time is up at the
 * box, and nothing new may be asked after it.
 */
export const TIMEBOX_HANGUP_GRACE_SEC = 15;

/**
 * How long after the scheduled hangup should have run the exactly-once sweep
 * checks that it did.
 *
 * The hangup is an ACTION (it needs Node and the OpenAI SDK) and a scheduled
 * action runs *at most* once — a dropped one is simply gone, and the Session
 * would stay `live` forever: no `endedAt`, no realtime spendEvent, no
 * Assessment, and counting against that Student's caps for the whole rolling
 * week. {@link sweepTimebox} is a scheduled MUTATION, which runs exactly once,
 * so it cannot be dropped in turn. This slack keeps it behind the action on the
 * happy path, so the normal ending is still the one that hangs the call up.
 */
export const TIMEBOX_SWEEP_SLACK_SEC = 60;

/**
 * How long after a Session ends the deployment waits before freezing the
 * Transcript and opening the Assessment.
 *
 * The server accepts Transcript writes for {@link TIMEBOX_GRACE_SEC} past the
 * end, precisely so the client's last in-flight flush lands. Reading the
 * Transcript before that window closes means grading a record that is still
 * being written — the closing exchange rated `not_probed`, or, for a Session
 * whose first flush had not landed at all, no Assessment produced. So the seam
 * that opens the Assessment waits for the window it was given to close.
 */
export const SEAL_DELAY_SEC = TIMEBOX_GRACE_SEC + 5;

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

/**
 * The OpenAI Realtime model that conducts a Session. Pinned rather than
 * defaulted so an SDK upgrade cannot silently change the Examiner's voice or
 * behaviour mid-pilot. `gpt-realtime-2.1` is also the SDK's own default and
 * the model the Examiner prompt was pressure-tested against.
 */
export const REALTIME_MODEL = "gpt-realtime-2.1";

/**
 * The Examiner's voice. `marin` and `cedar` are the two OpenAI recommends for
 * quality; `marin` reads as neutral and unhurried, which is what an
 * examination wants.
 */
export const EXAMINER_VOICE = "marin";

/**
 * The ASR model that transcribes the Student's speech. Input transcription is
 * a separate best-effort pass, not the Examiner's own hearing — a Student turn
 * can legitimately end up with no text at all (see the transcript-capture
 * research, .scratch/viva-mvp/issues/03-transcript-capture-and-timebox.md).
 */
export const INPUT_TRANSCRIPTION_MODEL = "gpt-live-transcribe";

/**
 * The text model that will grade a Session (ticket #5). Pinned here so the
 * Examiner and the Grader model ids sit side by side and neither can drift
 * unnoticed. `gpt-5.6-sol` is the current flagship.
 */
export const GRADER_MODEL = "gpt-5.6-sol";

/**
 * Lifetime of the OpenAI Realtime client secret handed to the browser. It
 * gates connection START only — it cannot time-box a Session — so it is kept
 * short: long enough to cover a page navigation and a microphone permission
 * prompt, too short to hoard.
 */
export const CLIENT_SECRET_TTL_SEC = 120;

/**
 * How long after the Grader is scheduled an Assessment may sit `pending`
 * before the deployment gives up on that run and marks it `failed`.
 *
 * This exists because of an asymmetry in the Convex scheduler: a scheduled
 * MUTATION runs exactly once, but a scheduled ACTION runs *at most* once and is
 * never retried. The Grader is an action (it needs Node and the OpenAI SDK), so
 * a dropped run would otherwise leave an Assessment `pending` forever with
 * nothing to notice. The sweep that uses this constant is itself a scheduled
 * mutation, so it cannot be dropped in turn. Generous: a real Grader run on a
 * fifteen-minute Transcript is tens of seconds, so this only ever fires on a
 * run that is genuinely never coming back.
 */
export const GRADER_STALL_SEC = 600;

/**
 * PLACEHOLDER list price of the Grader model, in USD per million tokens, as of
 * 2026-08 (`.scratch/viva-mvp/issues/04-grader-and-classifier-models.md`:
 * gpt-5.6-sol at $4/$20 per MTok).
 *
 * Unlike the realtime estimate these are multiplied by the token counts OpenAI
 * actually reports for the call, so the recorded `grader` spend is an
 * arithmetic result rather than a guess — the only estimate in it is the price.
 * Update alongside {@link GRADER_MODEL}; the cost-model ticket
 * (`.scratch/viva-mvp/issues/08-cost-model.md`) validates both.
 */
export const GRADER_USD_PER_INPUT_MTOK = 4;

/** @see GRADER_USD_PER_INPUT_MTOK */
export const GRADER_USD_PER_OUTPUT_MTOK = 20;
