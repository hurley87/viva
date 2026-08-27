"use node";

import { createHash } from "node:crypto";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalAction } from "./_generated/server";
import {
  CLIENT_SECRET_TTL_SEC,
  REALTIME_MODEL,
  REALTIME_VOICE,
  TRANSCRIPTION_MODEL,
} from "./examiner/constants";
import { assembleExaminerInstructions } from "./examiner/instructions";

function requireOpenAiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set on the Convex deployment. Add it with npx convex env set OPENAI_API_KEY.",
    );
  }
  return apiKey;
}

function safetyIdentifier(userId: string): string {
  return createHash("sha256").update(`viva:${userId}`).digest("hex");
}

function readClientSecret(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("OpenAI client secret response was empty");
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.value === "string") {
    return record.value;
  }
  const nested = record.client_secret;
  if (
    typeof nested === "object" &&
    nested !== null &&
    typeof (nested as Record<string, unknown>).value === "string"
  ) {
    return (nested as Record<string, unknown>).value as string;
  }
  throw new Error("OpenAI client secret response was missing value");
}

export const createClientSecret = action({
  args: { sessionId: v.id("sessions") },
  returns: v.object({
    clientSecret: v.string(),
    examinerInstructions: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const examiner = await ctx.runQuery(internal.sessions.examinerContext, {
      sessionId: args.sessionId,
    });
    const examinerInstructions = assembleExaminerInstructions(examiner.prompt);
    const apiKey = requireOpenAiKey();

    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": safetyIdentifier(examiner.userId),
        },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SEC },
          session: {
            type: "realtime",
            model: REALTIME_MODEL,
            instructions: examinerInstructions,
            audio: {
              output: { voice: REALTIME_VOICE },
              input: {
                transcription: {
                  model: TRANSCRIPTION_MODEL,
                  delay: "low",
                  languages: ["en"],
                },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.error("OpenAI client_secrets failed", response.status, detail);
      throw new Error("Unable to start the Examiner. Please try again.");
    }

    const clientSecret = readClientSecret(await response.json());
    return { clientSecret, examinerInstructions };
  },
});

export const hangupSession = internalAction({
  args: { sessionId: v.id("sessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const callId = await ctx.runQuery(internal.sessions.getCallId, {
      sessionId: args.sessionId,
    });

    if (callId) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error("OPENAI_API_KEY missing; cannot hang up Realtime call");
      } else {
        const response = await fetch(
          `https://api.openai.com/v1/realtime/calls/${callId}/hangup`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
          },
        );
        if (!response.ok) {
          const detail = await response.text();
          console.error("Realtime hangup failed", response.status, detail);
        }
      }
    }

    await ctx.runMutation(internal.sessions.finalizeTimebox, {
      sessionId: args.sessionId,
    });
    return null;
  },
});
