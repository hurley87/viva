"use client";

import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  tool,
  type RealtimeItem,
} from "@openai/agents/realtime";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { examinerCaptions } from "@/lib/examiner-captions";
import { formatCountdown } from "@/lib/session-clock";
import { useTranscriptPersistence } from "@/lib/use-transcript-persistence";

const REALTIME_MODEL = "gpt-realtime-2.1";

const buttonClassName =
  "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900";

type ToolReason = "timebox" | "dead_threads" | "student_request";

function endReasonCopy(
  reason: "student_hangup" | "timebox" | "examiner_ended" | "disconnected",
): string {
  switch (reason) {
    case "timebox":
      return "Time is up.";
    case "examiner_ended":
      return "The Examiner ended the Session.";
    case "student_hangup":
      return "You ended the Session.";
    case "disconnected":
      return "The Session disconnected.";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function SessionScreen({ sessionId }: { sessionId: string }) {
  const typedSessionId = sessionId as Id<"sessions">;
  const me = useQuery(api.users.me);
  const session = useQuery(
    api.sessions.get,
    me?.role === "student" ? { sessionId: typedSessionId } : "skip",
  );

  if (me === undefined || (me?.role === "student" && session === undefined)) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <p>Loading Session…</p>
      </main>
    );
  }

  if (me === null) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Session</h1>
        <p>Sign in as a Student to start or resume a Session.</p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  if (me.role !== "student") {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Session</h1>
        <p>Live Sessions are taken by Students.</p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  if (session === null || session === undefined) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Session</h1>
        <p>This Session was not found, or it does not belong to you.</p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  if (session.status === "ended") {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          {session.assignmentTitle}
        </h1>
        <p>
          This Session has ended
          {session.endReason ? ` — ${endReasonCopy(session.endReason)}` : "."}
        </p>
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
      </main>
    );
  }

  return (
    <LiveSession
      sessionId={typedSessionId}
      assignmentTitle={session.assignmentTitle}
      startedAt={session.startedAt}
      timeboxSec={session.timeboxSec}
      warningAtSec={session.warningAtSec}
    />
  );
}

function LiveSession({
  sessionId,
  assignmentTitle,
  startedAt,
  timeboxSec,
  warningAtSec,
}: {
  sessionId: Id<"sessions">;
  assignmentTitle: string;
  startedAt: number;
  timeboxSec: number;
  warningAtSec: number;
}) {
  const createClientSecret = useAction(api.realtime.createClientSecret);
  const reportCallId = useMutation(api.sessions.reportCallId);
  const endSession = useMutation(api.sessions.end);
  const {
    onHistoryUpdated,
    onAudioInterrupted,
    onAgentEnd,
    onTransportEvent,
    flushNow,
  } = useTranscriptPersistence(sessionId);

  const realtimeRef = useRef<RealtimeSession | null>(null);
  const warningSent = useRef(false);
  const timeupSent = useRef(false);
  const ending = useRef(false);

  const [captions, setCaptions] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [phase, setPhase] = useState<"connecting" | "live" | "error">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);

  const remainingMs = startedAt + timeboxSec * 1000 - now;
  const elapsedSec = (now - startedAt) / 1000;
  const isWarning = elapsedSec >= warningAtSec && remainingMs > 0;

  const closeRealtime = useCallback(() => {
    realtimeRef.current?.close();
    realtimeRef.current = null;
  }, []);

  const finish = useCallback(
    async (reason: ToolReason | "disconnected") => {
      if (ending.current) {
        return;
      }
      ending.current = true;
      try {
        await flushNow();
        await endSession({ sessionId, reason });
      } catch (finishError) {
        console.error("Failed to record Session end", finishError);
      } finally {
        closeRealtime();
      }
    },
    [closeRealtime, endSession, flushNow, sessionId],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const realtime = realtimeRef.current;
    if (!realtime || phase !== "live") {
      return;
    }
    if (elapsedSec >= warningAtSec && !warningSent.current) {
      warningSent.current = true;
      realtime.sendMessage("[SYSTEM: two minutes remaining]");
    }
    if (elapsedSec >= timeboxSec && !timeupSent.current) {
      timeupSent.current = true;
      realtime.sendMessage("[SYSTEM: time is up]");
      window.setTimeout(() => {
        void finish("timebox");
      }, 4000);
    }
  }, [elapsedSec, finish, phase, timeboxSec, warningAtSec]);

  useEffect(() => {
    let cancelled = false;

    const endSessionTool = tool({
      name: "end_session",
      description:
        "End the examination session. Call only per your TIME, STALL, or ENDING rules.",
      parameters: z.object({
        reason: z.enum(["timebox", "dead_threads", "student_request"]),
      }),
      execute: async ({ reason }: { reason: ToolReason }) => {
        await finish(reason);
        return "Session ended.";
      },
    });

    async function connect() {
      try {
        const minted = await createClientSecret({ sessionId });
        if (cancelled) {
          return;
        }

        const agent = new RealtimeAgent({
          name: "Examiner",
          instructions: minted.examinerInstructions,
          tools: [endSessionTool],
        });

        const realtime = new RealtimeSession(agent, {
          model: REALTIME_MODEL,
          tracingDisabled: true,
          config: {
            outputModalities: ["audio"],
            reasoning: { effort: "low" },
            audio: {
              input: {
                transcription: {
                  model: "gpt-live-transcribe",
                  delay: "low",
                  languages: ["en"],
                },
              },
              output: { voice: "marin" },
            },
          },
        });

        realtime.on("history_updated", (history: RealtimeItem[]) => {
          setCaptions(examinerCaptions(history));
          onHistoryUpdated(history);
        });
        realtime.on("audio_interrupted", () => {
          onAudioInterrupted();
        });
        realtime.on("agent_end", () => {
          onAgentEnd();
        });
        realtime.on("transport_event", (event: { type: string }) => {
          onTransportEvent(event);
        });

        await realtime.connect({ apiKey: minted.clientSecret });
        if (cancelled) {
          realtime.close();
          return;
        }

        realtimeRef.current = realtime;
        const callId = (realtime.transport as OpenAIRealtimeWebRTC).callId;
        if (callId) {
          await reportCallId({ sessionId, openaiCallId: callId });
        }
        setPhase("live");
      } catch (connectError) {
        if (cancelled) {
          return;
        }
        setPhase("error");
        setError(
          connectError instanceof Error
            ? connectError.message
            : String(connectError),
        );
      }
    }

    void connect();

    return () => {
      cancelled = true;
      closeRealtime();
    };
  }, [
    closeRealtime,
    createClientSecret,
    finish,
    onAgentEnd,
    onAudioInterrupted,
    onHistoryUpdated,
    onTransportEvent,
    reportCallId,
    sessionId,
  ]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Session</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {assignmentTitle}
          </h1>
        </div>
        <div className="text-right">
          <p
            className={`font-mono text-2xl tabular-nums ${
              isWarning ? "text-amber-600 dark:text-amber-400" : ""
            }`}
          >
            {formatCountdown(remainingMs)}
          </p>
          {isWarning ? (
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Two minutes left.
            </p>
          ) : null}
        </div>
      </div>

      {phase === "connecting" ? (
        <p>Connecting to the Examiner… allow microphone access when asked.</p>
      ) : null}
      {phase === "error" ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <section className="flex min-h-48 flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          Examiner
        </h2>
        {captions.length === 0 ? (
          <p className="text-zinc-500">Captions of the Examiner will appear here.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {captions.map((line, index) => (
              <li key={`${index}-${line.slice(0, 24)}`} className="leading-6">
                {line}
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <Link className="text-sm underline" href="/">
          Back home
        </Link>
        <button
          type="button"
          className={buttonClassName}
          disabled={phase !== "live"}
          onClick={() => void finish("student_request")}
        >
          End Session
        </button>
      </div>
    </main>
  );
}
