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
 * This is INV-1 mechanism (a) in mechanical form: the instructions are baked
 * into the session the secret authorises, server-side. The browser receives
 * the secret and nothing else, and the `RealtimeAgent` it builds deliberately
 * carries no instructions of its own, so the `session.update` it sends on
 * connect omits the field entirely and cannot overwrite these.
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
 * The time-box enforcement path (PRD §4 INV-4 build note).
 *
 * The client countdown is UX. This is what actually stops a Session: it ends
 * the OpenAI call from the server, with the server's own key, and finalizes
 * the Session — so a tampered, frozen, or simply closed browser changes
 * nothing about when the Session ends.
 *
 * Scheduled twice per Session, from the mint and from the real start, and safe
 * both times:
 *   - already ended -> no-op.
 *   - not due yet   -> re-arm at the real cutoff. This is the mint-time
 *                      backstop arriving early for a Session that connected
 *                      late; ending it here would cut a Student short.
 *   - due           -> hang up, then finalize.
 *
 * Scheduled actions run at most once, so the re-arm above also repairs the
 * case where the accurate job was dropped: whichever job is still alive
 * rediscovers the cutoff from the Session itself.
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
      if (state.msUntilCutoff > 0 && state.msUntilCutoff <= MAX_REARM_MS) {
        await ctx.scheduler.runAfter(
          state.msUntilCutoff + REARM_SLACK_MS,
          internal.examiner.realtime.enforceTimebox,
          { sessionId: args.sessionId },
        );
      }
      return null;
    }

    // Hang the call up first, so the Examiner cannot speak past the box even
    // if the write below has to be retried. A call that is already gone
    // answers 404: that is a success for our purposes, not a failure, and it
    // must never block the finalize.
    if (state.openaiCallId !== null) {
      try {
        await openaiClient().realtime.calls.hangup(state.openaiCallId);
      } catch (error) {
        console.warn(
          `Time-box hangup for Session ${args.sessionId} did not succeed ` +
            `(call ${state.openaiCallId}): ${String(error)}. Finalizing anyway.`,
        );
      }
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
