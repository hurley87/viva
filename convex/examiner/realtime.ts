"use node";

// The two things the Session lifecycle needs a real Node runtime and the
// server's OpenAI key for: minting the browser's client secret, and hanging up
// a call the browser will not.
//
// `"use node"` applies to the whole file, so this module contains only actions
// — its mutations and queries live in convex/sessions.ts and are reached
// through `ctx.runMutation` / `ctx.runQuery`.
//
// INV-3 (PRD §4): this module is on the live-Session path. It holds no import
// of, and no reference to, the Grader-only island the post-Session evaluation
// reads. The only Assignment content it ever sees is the assembled
// instructions string handed to it by the mint.

import OpenAI from "openai";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import {
  CLIENT_SECRET_TTL_SEC,
  EXAMINER_VOICE,
  INPUT_TRANSCRIPTION_MODEL,
  REALTIME_MODEL,
} from "../lib/constants";

const MS_PER_SEC = 1000;

/**
 * How far ahead the enforcement job will re-arm itself. A job that fires early
 * reschedules to the real cutoff; this bound stops a corrupt timestamp from
 * parking a job in the far future.
 */
const MAX_REARM_MS = 60 * 60 * MS_PER_SEC;

/** Small slack so a re-armed job lands after the cutoff, never on it. */
const REARM_SLACK_MS = 2 * MS_PER_SEC;

function openaiClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set on this Convex deployment. Convex functions " +
        "do not read .env.local — run `npx convex env set OPENAI_API_KEY ...`.",
    );
  }
  return new OpenAI({ apiKey });
}

/**
 * Mint the short-lived `ek_...` secret the browser connects with, carrying the
 * Examiner's instructions.
 *
 * This is INV-1 mechanism (a) in mechanical form: the instructions are
 * assembled and baked into the session the secret authorises, server-side. The
 * browser receives the secret and nothing else — it never sees, and never
 * builds, the instruction text.
 *
 * What that does *not* mean. Our own `RealtimeAgent` deliberately carries no
 * instructions, so the `session.update` it sends on connect omits the field and
 * leaves these standing, and the invariant suite fails if that guard is ever
 * dropped. But that is a property of OUR client code, not of the platform: the
 * same `ek_` secret authorises a `session.update` carrying any `instructions` a
 * hand-rolled client cares to send, and whether OpenAI refuses one from an
 * ephemeral credential is unverified. INV-1's stated bar is detection, not
 * prevention (PRD §4): what the deployment guarantees is that no position-supply
 * goes unnoticed, through the Grader's post-hoc audit of the Transcript — which
 * reads what the Examiner actually said, whatever instructions produced it.
 *
 * The audio configuration is set here as well as on the client. The client's
 * config is merged over this one, so this is not a guarantee — it is the floor
 * a client that sends nothing still gets.
 */
export const createClientSecret = internalAction({
  args: { instructions: v.string() },
  returns: v.object({ clientSecret: v.string(), expiresAt: v.number() }),
  handler: async (_ctx, args) => {
    const client = openaiClient();
    const secret = await client.realtime.clientSecrets.create({
      expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SEC },
      session: {
        type: "realtime",
        model: REALTIME_MODEL,
        instructions: args.instructions,
        output_modalities: ["audio"],
        audio: {
          input: {
            transcription: {
              model: INPUT_TRANSCRIPTION_MODEL,
              language: "en",
            },
            turn_detection: { type: "semantic_vad", interrupt_response: true },
            noise_reduction: { type: "near_field" },
          },
          output: { voice: EXAMINER_VOICE },
        },
      },
    });
    return { clientSecret: secret.value, expiresAt: secret.expires_at };
  },
});

/**
 * End the OpenAI call for a Session, ignoring the ways it can already be gone.
 *
 * A call that is already over answers 404. That is the outcome we wanted, not a
 * failure — and it is the ordinary case whenever the time-box path hung up
 * inline a moment before `sessions.finalize`'s scheduled hangup arrives. It
 * must never be loud, and it must never block anything.
 */
async function hangup(callId: string, sessionId: string): Promise<void> {
  try {
    await openaiClient().realtime.calls.hangup(callId);
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 404) {
      return;
    }
    console.warn(
      `Hangup for Session ${sessionId} did not succeed (call ${callId}): ` +
        `${String(error)}.`,
    );
  }
}

/**
 * End the OpenAI call for a Session that has just ended, whatever ended it.
 *
 * Scheduled by `sessions.finalize` on every path that ends a Session — the
 * Examiner's `end_session` tool, the Student's own control, a reported
 * disconnect, the time-box, the exactly-once sweep. Finalizing is a database
 * write and the audio leg lives at OpenAI, so ending a Session used to end
 * nothing at all for a browser that kept its WebRTC connection open: the
 * Examiner went on conversing, to OpenAI's 60-minute platform cap, past the
 * Transcript write window and therefore unrecorded, ungraded, un-audited for
 * INV-1 and unbilled against the breaker.
 *
 * A mutation cannot reach OpenAI, so this is the action it schedules. It is
 * best-effort by nature: a scheduled action runs at most once, and the call may
 * already be gone.
 */
export const hangupCall = internalAction({
  args: { sessionId: v.id("sessions"), openaiCallId: v.string() },
  returns: v.null(),
  handler: async (_ctx, args): Promise<null> => {
    await hangup(args.openaiCallId, args.sessionId);
    return null;
  },
});

/**
 * The time-box enforcement path (PRD §4 INV-4 build note).
 *
 * The client countdown is UX. This is what actually stops a Session: it ends
 * the OpenAI call from the server, with the server's own key, and finalizes
 * the Session — so a tampered, frozen, or simply closed browser changes
 * nothing about when the Session ends.
 *
 * It fires at the time-box plus TIMEBOX_HANGUP_GRACE_SEC, not at the time-box
 * itself. The Examiner is told the time is up at the box and answers with one
 * closing sentence; severing the audio at the same instant made that closing
 * line unreachable, so every expiring Session ended mid-sentence. The grace is
 * the window the graceful ending happens in — it is not slack in the time-box,
 * which is still `startedAt + timeboxSec`.
 *
 * Scheduled twice per Session, from the mint and from the real start, and safe
 * both times:
 *   - already ended -> no-op.
 *   - not due yet   -> re-arm at the real hangup instant. This is the mint-time
 *                      backstop arriving early for a Session that connected
 *                      late; ending it here would cut a Student short.
 *   - due           -> hang up, then finalize.
 *
 * Scheduled actions run at most once, so the re-arm above also repairs the
 * case where the accurate job was dropped: whichever job is still alive
 * rediscovers the deadline from the Session itself. It cannot repair the case
 * where *every* copy was dropped — that is what the exactly-once
 * `internal.sessions.sweepTimebox` mutation is for.
 */
export const enforceTimebox = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const state = await ctx.runQuery(internal.sessions.timeboxState, {
      sessionId: args.sessionId,
    });
    if (state === null || state.status === "ended") {
      return null;
    }

    if (!state.dueNow) {
      if (state.msUntilHangup > 0 && state.msUntilHangup <= MAX_REARM_MS) {
        await ctx.scheduler.runAfter(
          state.msUntilHangup + REARM_SLACK_MS,
          internal.examiner.realtime.enforceTimebox,
          { sessionId: args.sessionId },
        );
      }
      return null;
    }

    // Hang the call up first, so the Examiner cannot speak past the grace even
    // if the write below has to be retried. `finalize` schedules a hangup of
    // its own for every ending path; doing it inline here keeps the enforcement
    // path from depending on a second at-most-once action.
    if (state.openaiCallId !== null) {
      await hangup(state.openaiCallId, args.sessionId);
    }

    await ctx.runMutation(internal.sessions.finalize, {
      sessionId: args.sessionId,
      // A Session that never went live did not run out of time; it never
      // arrived. Recording that honestly keeps `timebox` meaning "the Examiner
      // was stopped mid-examination".
      endReason: state.status === "live" ? "timebox" : "disconnected",
    });
    return null;
  },
});
