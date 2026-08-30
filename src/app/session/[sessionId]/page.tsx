"use client";

// The live Session screen.
//
// What is UX here and what is enforcement, because the difference matters:
//
//   UX          the countdown, the two-minute banner, the captions, the
//               [SYSTEM: ...] notes injected into the conversation, and the
//               client-side hangup a few seconds past the box.
//   ENFORCEMENT the scheduled server job that ends the OpenAI call and
//               finalizes the Session (convex/examiner/realtime.ts). It runs
//               whatever this page does — frozen, tampered with, or closed.
//
// INV-1 mechanism (a): the Examiner's instructions are assembled server-side
// and baked into the short-lived client secret. The `RealtimeAgent` built here
// deliberately carries NO instructions, so the `session.update` the SDK sends
// on connect omits the field entirely rather than overwriting them with an
// empty string. Do not give this agent instructions.
//
// PRD §7: captions show the Examiner's speech only. The Student's own words
// are never captioned — there is no relitigating ASR mid-examination.

import {
  RealtimeAgent,
  RealtimeSession,
  tool,
  type RealtimeItem,
} from "@openai/agents/realtime";
import type { OpenAIRealtimeWebRTC } from "@openai/agents/realtime";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import Link from "next/link";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  EXAMINER_VOICE,
  INPUT_TRANSCRIPTION_MODEL,
  REALTIME_MODEL,
} from "../../../../convex/lib/constants";
import { takeClientSecret } from "../../../lib/sessionHandoff";
import {
  createTranscriptRecorder,
  toTranscriptRows,
  turnSignal,
  type TranscriptRecorder,
} from "../../../lib/transcript";

/** How long the Examiner's closing sentence is given to finish playing. */
const CLOSING_AUDIO_MS = 2_000;

/**
 * How far ahead of the server's own hangup this page hangs up.
 *
 * The server severs the call at `startedAt + timeboxSec + hangupGraceSec`, and
 * that grace is the window in which the Examiner hears `[SYSTEM: time is up]`,
 * says one closing sentence and calls `end_session`. So this page has to wait
 * out almost all of it: hanging up at the time-box itself would cut off the
 * very closing line the grace exists for. It hangs up a few seconds early only
 * so that a Session the Examiner never closes does not leave the Student
 * listening to silence until the server job runs.
 */
const CLIENT_HANGUP_LEAD_SEC = 3;

/**
 * How long a change to the Transcript may sit in this tab before it is written
 * to Convex. It is the worst case a crashed tab costs: everything older than
 * this is already durable (ticket #4 / ADR-0001).
 */
const TRANSCRIPT_DEBOUNCE_MS = 1_000;

const SYSTEM_WARNING_NOTE = "[SYSTEM: two minutes remaining]";
const SYSTEM_TIME_UP_NOTE = "[SYSTEM: time is up]";

/**
 * The reasons the Examiner may end a Session (approved prototype §2). The
 * server maps them onto the Session's own vocabulary; `disconnected` is added
 * here for a transport that drops.
 */
type ClientEndReason =
  | "timebox"
  | "dead_threads"
  | "student_request"
  | "disconnected";

type Phase =
  | "connecting"
  | "live"
  | "ending"
  | "ended"
  | "unavailable"
  | "failed";

type Caption = { itemId: string; text: string };

/**
 * An agent with no instructions of its own. The SDK omits `instructions` from
 * its `session.update` when this returns `undefined`, which is what leaves the
 * server-minted instructions intact (INV-1 mechanism a).
 */
const NO_CLIENT_INSTRUCTIONS = (() => undefined) as unknown as () => string;

/** Examiner turns only. A Student's own speech is never captioned (PRD §7). */
function examinerCaptions(history: RealtimeItem[]): Caption[] {
  const captions: Caption[] = [];
  for (const item of history) {
    if (item.type !== "message" || item.role !== "assistant") {
      continue;
    }
    const text = item.content
      .map((part) => {
        if (part.type === "output_text") return part.text;
        if (part.type === "output_audio") return part.transcript ?? "";
        return "";
      })
      .join("")
      .trim();
    if (text.length > 0) {
      captions.push({ itemId: item.itemId, text });
    }
  }
  return captions;
}

/**
 * `DOMException` names `navigator.mediaDevices.getUserMedia` rejects with. The
 * Realtime transport acquires the microphone itself and lets that rejection
 * through untouched, so this is what a Student who blocked the prompt — or has
 * no working input device — arrives here with.
 */
const MICROPHONE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "OverconstrainedError",
  "SecurityError",
]);

/** Whether a failed connect was the microphone rather than the network. */
function isMicrophoneFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  const { name } = error as { name: unknown };
  return typeof name === "string" && MICROPHONE_ERROR_NAMES.has(name);
}

function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function SessionPage({
  params,
}: PageProps<"/session/[sessionId]">) {
  const { sessionId } = use(params);
  return (
    <>
      <AuthLoading>
        <Shell>Checking your session…</Shell>
      </AuthLoading>
      <Unauthenticated>
        <Shell>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Sign in to take a Session
          </h1>
          <p className="mt-8">
            <Link
              href="/login"
              className="inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
            >
              Sign in
            </Link>
          </p>
        </Shell>
      </Unauthenticated>
      <Authenticated>
        <LiveSession sessionId={sessionId as Id<"sessions">} />
      </Authenticated>
    </>
  );
}

function LiveSession({ sessionId }: { sessionId: Id<"sessions"> }) {
  const details = useQuery(api.sessions.getForStudent, { sessionId });
  const startSession = useMutation(api.sessions.start);
  const endSession = useMutation(api.sessions.end);
  const upsertTranscript = useMutation(api.transcript.upsert);

  const [phase, setPhase] = useState<Phase>("connecting");
  const [failure, setFailure] = useState<string | null>(null);
  const [failureIsMicrophone, setFailureIsMicrophone] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [warned, setWarned] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  const realtimeRef = useRef<RealtimeSession | null>(null);
  const bootedRef = useRef(false);
  const endingRef = useRef(false);
  /** Set once `connect()` has resolved: past that point the call exists. */
  const connectedRef = useRef(false);
  const finishRef = useRef<
    ((reason: ClientEndReason, closeDelayMs?: number) => void) | null
  >(null);
  const leaveRef = useRef<(() => void) | null>(null);
  const unmountTimerRef = useRef<number | null>(null);
  // The one-shot marks for the timer below. They are refs rather than locals
  // inside that effect because the effect re-runs whenever the Session doc
  // changes, and a note that has been sent must stay sent.
  const warningSentRef = useRef(false);
  const timeUpSentRef = useRef(false);
  const hungUpRef = useRef(false);
  const captionsScrollRef = useRef<HTMLElement | null>(null);
  const recorderRef = useRef<TranscriptRecorder | null>(null);

  /**
   * End the Session, once. Every path lands here: the Examiner's `end_session`
   * tool, the Student's own control, the client-side time-box, and a dropped
   * transport. The server mutation is idempotent, so racing the scheduled
   * hangup is safe — whichever arrives first sets the reason.
   */
  const finish = useCallback(
    (reason: ClientEndReason, closeDelayMs = CLOSING_AUDIO_MS) => {
      if (endingRef.current) {
        return;
      }
      endingRef.current = true;
      // Before anything else: get the last turns out of this tab. The server
      // accepts writes for a short grace past the end, so this lands even when
      // the reason for ending is the time-box.
      recorderRef.current?.flush();
      setPhase("ending");
      void endSession({ sessionId, reason }).catch(() => {
        // The Session ends regardless: the scheduled server job finalizes it.
      });
      window.setTimeout(() => {
        realtimeRef.current?.close();
        setPhase("ended");
      }, closeDelayMs);
    },
    [endSession, sessionId],
  );
  // Kept in a ref so the Examiner's `end_session` tool — built once, inside
  // the connect effect — always calls the current one.
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  /**
   * Leave with no screen left to say it on: the tab is closing, or this page
   * has been navigated away from. The same work as `finish`, minus the state
   * updates and minus the delay that lets the Examiner's closing sentence
   * play — there is nobody left to hear it.
   *
   * The recorder is deliberately not disposed. Its retry timer outlives this
   * component and the Convex mutation it holds still works, so a final write
   * that has to be retried is better off left running (ADR-0001).
   */
  const leaveSession = useCallback(() => {
    if (endingRef.current) {
      return;
    }
    endingRef.current = true;
    // Best effort, and the reason the debounce exists: everything older than
    // one second is already in Convex whether or not this write survives.
    recorderRef.current?.flush();
    realtimeRef.current?.close();
    void endSession({ sessionId, reason: "disconnected" }).catch(() => {});
  }, [endSession, sessionId]);
  useEffect(() => {
    leaveRef.current = leaveSession;
  }, [leaveSession]);

  // Connect once. There is deliberately no teardown in this effect's cleanup:
  // React runs effects twice in development, and closing the call on the first
  // cleanup would kill the Session that was just connected. The Session is
  // closed by `finish` above — and, whatever this page does, by the scheduled
  // server hangup.
  useEffect(() => {
    if (bootedRef.current || details === undefined) {
      return;
    }
    bootedRef.current = true;
    const loaded = details;

    const endSessionTool = tool({
      name: "end_session",
      description:
        "End the examination Session. Call only per your TIME, STALL, or " +
        "ENDING rules.",
      parameters: z.object({
        reason: z.enum(["timebox", "dead_threads", "student_request"]),
      }),
      execute: async ({ reason }) => {
        finishRef.current?.(reason);
        return "ok";
      },
    });

    const examiner = new RealtimeAgent({
      name: "Examiner",
      instructions: NO_CLIENT_INSTRUCTIONS,
      tools: [endSessionTool],
    });

    const realtime = new RealtimeSession(examiner, {
      // `connect({ model })` is ignored by the SDK; the constructor is the
      // only place the model takes effect.
      model: REALTIME_MODEL,
      config: {
        audio: {
          input: {
            transcription: {
              model: INPUT_TRANSCRIPTION_MODEL,
              language: "en",
            },
            turnDetection: { type: "semantic_vad", interruptResponse: true },
            noiseReduction: { type: "near_field" },
          },
          output: { voice: EXAMINER_VOICE },
        },
      },
    });
    realtimeRef.current = realtime;

    // ---------------------------------------------------------------------
    // Transcript persistence (ADR-0001: the Transcript is the sole Session
    // record). Rows are derived from the SDK's reconciled history snapshots —
    // keyed by `itemId`, never assembled from raw deltas — and upserted
    // continuously, so a killed tab costs at most TRANSCRIPT_DEBOUNCE_MS of
    // conversation rather than the Session.
    //
    // The debounce is bypassed at the three moments a turn stops changing: an
    // ASR final (or failure) landing, a barge-in truncation, and the Examiner
    // finishing a turn. `finish` flushes on the way out, and so does a closing
    // tab. The server refuses anything past the time-box regardless.
    // ---------------------------------------------------------------------
    const recorder = createTranscriptRecorder(
      (rows) => upsertTranscript({ sessionId, items: [...rows] }),
      TRANSCRIPT_DEBOUNCE_MS,
    );
    recorderRef.current = recorder;

    // The latest snapshot, so an event that is not `history_updated` can still
    // re-derive rows from the reconciled history rather than from itself.
    let latestHistory: RealtimeItem[] = [];
    const truncatedItemIds = new Set<string>();
    // Set when a turn has settled but its reconciled text has not arrived yet:
    // the snapshot that follows is written without waiting out the debounce.
    let flushOnNextSnapshot = false;

    // The recorder is deliberately not disposed here, for the same reason
    // this effect has no teardown: React's development double-mount would
    // dispose the one the surviving mount is using.
    function persist(immediate: boolean) {
      recorder.record(toTranscriptRows(latestHistory, { truncatedItemIds }));
      if (immediate) {
        recorder.flush();
      }
    }

    realtime.on("history_updated", (history) => {
      latestHistory = history;
      setCaptions(examinerCaptions(history));
      const immediate = flushOnNextSnapshot;
      flushOnNextSnapshot = false;
      persist(immediate);
    });

    // Every raw server event passes through here. Only two matter to the
    // Transcript: a Student turn's ASR settling (completed or failed — both
    // mean the turn will not change again), and the truncation of an Examiner
    // turn, whose item id arrives nowhere else.
    realtime.on("transport_event", (event) => {
      const signal = turnSignal(event);
      if (signal === null) {
        return;
      }
      // Either way the reconciled item follows this event (the SDK re-retrieves
      // it), so the snapshot that arrives next is written without waiting out
      // the debounce.
      flushOnNextSnapshot = true;
      if (signal.kind === "truncated") {
        // The mark is new information and it is correct now: this event is the
        // only place the interrupted turn is identified.
        truncatedItemIds.add(signal.itemId);
        persist(true);
        return;
      }
      // An ASR final. The text in the *current* snapshot is the pre-merge one —
      // the SDK merges the final into history after this event — so writing now
      // would record the Student's turn as `text: "", textStatus: "failed"` and
      // rely on the correction beating the server's write cutoff. Near the
      // time-box it does not: the failed row is accepted and the corrected one
      // refused, and the Student's last answer reaches the Grader blank. Record
      // the turn so it is not lost, and let the merged snapshot be what is
      // flushed.
      persist(false);
    });

    // Barge-in. The WebRTC transport handles audio itself and generally does
    // not raise this — `conversation.item.truncated` above is the reliable
    // signal — so this is a belt-and-braces mark on whichever Examiner turn
    // was still speaking.
    realtime.on("audio_interrupted", () => {
      for (let i = latestHistory.length - 1; i >= 0; i -= 1) {
        const item = latestHistory[i];
        if (
          item.type === "message" &&
          item.role === "assistant" &&
          item.status === "in_progress"
        ) {
          truncatedItemIds.add(item.itemId);
          break;
        }
      }
      persist(true);
    });

    // The Examiner finished a turn: its transcript is complete, write it now.
    realtime.on("agent_end", () => {
      persist(true);
    });

    realtime.on("error", (error) => {
      console.error("Realtime Session error", error);
    });

    realtime.transport.on("connection_change", (status) => {
      if (status !== "disconnected") {
        return;
      }
      if (!connectedRef.current) {
        // The call never came up: a denied microphone, a refused SDP exchange.
        // The SDK's own failed-connection cleanup calls `close()`, which emits
        // this event SYNCHRONOUSLY — a microtask ahead of `connect()`'s
        // rejection being observed. Ending here would claim the ending first
        // and leave a Student whose microphone is blocked reading "The Session
        // has ended" instead of being told to unblock it. `boot`'s catch owns
        // this case.
        return;
      }
      // Includes the server hanging the call up at the time-box. The Session
      // is already finalized in that case and `finish` is a no-op on the
      // server side.
      finishRef.current?.("disconnected", 0);
    });

    async function boot() {
      // A Session connects exactly once. Anything else — a refresh, a pasted
      // link, a Session that has already run — has no client secret to use.
      if (loaded.session.status !== "minted") {
        setPhase("unavailable");
        return;
      }
      const clientSecret = takeClientSecret(sessionId);
      if (clientSecret === null) {
        setPhase("unavailable");
        return;
      }

      try {
        await realtime.connect({ apiKey: clientSecret });
        // Past this line the call exists, so a transport drop is an ending
        // rather than a failure to start. Before it, the `connection_change`
        // handler above deliberately stands aside.
        connectedRef.current = true;
        // The call id comes out of the SDP exchange and exists only once
        // `connect` resolves. It is what the scheduled server hangup posts to.
        const transport = realtime.transport as OpenAIRealtimeWebRTC;
        const started = await startSession({
          sessionId,
          openaiCallId: transport.callId,
        });
        setEndsAt(Date.now() + (started.endsAt - started.startedAt));
        setPhase("live");
      } catch (error: unknown) {
        // Claim the ending, so nothing else overwrites the explanation below.
        endingRef.current = true;
        realtime.close();
        setFailure(
          error instanceof Error
            ? error.message
            : "The Examiner could not be reached.",
        );
        setFailureIsMicrophone(isMicrophoneFailure(error));
        setPhase("failed");
        // Close the Session out rather than leaving it minted: a Session that
        // never ran is under the forgiveness floor, so this hands the Student
        // their attempt straight back instead of making them wait for the
        // server's backstop.
        void endSession({ sessionId, reason: "disconnected" }).catch(() => {});
      }
    }

    void boot();
  }, [details, endSession, sessionId, startSession, upsertTranscript]);

  // The countdown, the two-minute warning, the time-up note and the client-side
  // hangup. All four are driven from one timer so they cannot disagree.
  //
  // The dependencies are the three numbers, not the `details` object they came
  // out of, and the "already sent" marks are refs rather than locals. Both are
  // load-bearing: ending a Session patches the session doc, `getForStudent`
  // pushes a fresh object, and an effect that re-ran on that object would begin
  // again with nothing sent. Past `warningAtSec` — which is every Session that
  // runs to its end — the synchronous first tick would then either inject a
  // second `[SYSTEM: two minutes remaining]` into a Session that is closing, or
  // call `sendEvent` on a data channel the SDK has already closed, which throws
  // (`OpenAIRealtimeWebRTC#assertConnected`) and, from inside an effect body,
  // becomes the "This Session is not available" error page.
  const timeboxSec = details?.timeboxSec ?? null;
  const warningAtSec = details?.warningAtSec ?? null;
  const hangupGraceSec = details?.hangupGraceSec ?? null;
  useEffect(() => {
    if (
      endsAt === null ||
      timeboxSec === null ||
      warningAtSec === null ||
      hangupGraceSec === null
    ) {
      return;
    }
    const endsAtMs = endsAt;
    const boxSec = timeboxSec;
    const warnAtSec = warningAtSec;
    const startedAtMs = endsAtMs - boxSec * 1000;
    const hangUpAtSec =
      boxSec + Math.max(0, hangupGraceSec - CLIENT_HANGUP_LEAD_SEC);
    let timer: number | null = null;

    function note(text: string) {
      const realtime = realtimeRef.current;
      if (realtime === null || endingRef.current) {
        return;
      }
      // Only a live data channel takes an event: `sendEvent` throws on a closed
      // one, and a Session that is already closing has nobody left to act on
      // the note anyway.
      if (realtime.transport.status !== "connected") {
        return;
      }
      try {
        // An out-of-band `role: "system"` item — an operator signal, not
        // Student speech (approved prototype §3). `sendMessage` would file it
        // as a Student turn, which is why the raw transport event is used.
        realtime.transport.sendEvent({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{ type: "input_text", text }],
          },
        });
        realtime.transport.requestResponse?.();
      } catch (error) {
        // The one throw here that is genuinely expected: `status` is this
        // app's view of the transport, updated from events, so it can lag the
        // data channel's own `readyState` by a task — and `sendEvent` throws
        // on a channel that is no longer open. Swallowing it is right. The
        // note is advisory (the time-box is enforced by the server, which does
        // not need this event to have landed), whereas an exception raised on
        // this timer reaches React and replaces the Session with an error page.
        console.error("Could not deliver an operator note", error);
      }
    }

    function tick() {
      const elapsedSec = (Date.now() - startedAtMs) / 1000;
      setRemainingMs(endsAtMs - Date.now());
      if (!warningSentRef.current && elapsedSec >= warnAtSec) {
        warningSentRef.current = true;
        setWarned(true);
        note(SYSTEM_WARNING_NOTE);
      }
      if (!timeUpSentRef.current && elapsedSec >= boxSec) {
        timeUpSentRef.current = true;
        note(SYSTEM_TIME_UP_NOTE);
      }
      if (!hungUpRef.current && elapsedSec >= hangUpAtSec) {
        hungUpRef.current = true;
        finishRef.current?.("timebox", 0);
      }
      // Once the Session is closing there is nothing left for this timer to do,
      // and the countdown should stop where it stopped rather than run on
      // behind the ended screen.
      if (endingRef.current && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    tick();
    if (!endingRef.current) {
      timer = window.setInterval(tick, 250);
    }
    return () => {
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [endsAt, timeboxSec, warningAtSec, hangupGraceSec]);

  // A closing tab should not leave a live call behind.
  useEffect(() => {
    function onPageHide() {
      leaveRef.current?.();
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Neither should navigating away from it. `pagehide` covers a document being
  // unloaded, not a Student pressing Back out of a client-side route: without
  // this, the component unmounts, the countdown stops, and the call carries on
  // — microphone open, Examiner still speaking into an audio element nothing
  // is showing — until the server's hangup fires up to a time-box later.
  //
  // The teardown cannot live in the connect effect's cleanup, for the reason
  // that effect has none: React invokes effects twice in development, and the
  // first cleanup would close the call the second mount is using. So it is
  // deferred by one task and cancelled by a re-mount. A real unmount has no
  // re-mount to cancel it.
  useEffect(() => {
    if (unmountTimerRef.current !== null) {
      window.clearTimeout(unmountTimerRef.current);
      unmountTimerRef.current = null;
    }
    return () => {
      unmountTimerRef.current = window.setTimeout(() => {
        unmountTimerRef.current = null;
        leaveRef.current?.();
      }, 0);
    };
  }, []);

  // Keep the newest caption in view without moving the page: the captions are
  // their own scrolling region, so it is that region which scrolls.
  useEffect(() => {
    const region = captionsScrollRef.current;
    if (region !== null) {
      region.scrollTop = region.scrollHeight;
    }
  }, [captions]);

  if (details === undefined) {
    return <Shell>Loading this Session…</Shell>;
  }

  if (phase === "unavailable") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          This Session cannot be resumed
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          A Session connects once, at the moment it is started. This one has
          either already run or was left behind. Start a new Session — a
          Session that never ran does not count against your limit.
        </p>
        <BackLink />
      </Shell>
    );
  }

  if (phase === "failed") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          The Session could not start
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          {failure}
        </p>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          {failureIsMicrophone
            ? "Viva needs your microphone. Check that this site is allowed to use it, and that no other application is holding it, then start a new Session — this one did not count against your limit."
            : "Start a new Session when you are ready — this one did not count against your limit."}
        </p>
        <BackLink />
      </Shell>
    );
  }

  if (phase === "ended") {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          The Session has ended
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          Thank you. There is nothing further to do here.
        </p>
        <BackLink />
      </Shell>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-black">
      <header className="shrink-0 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-3xl items-baseline justify-between gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Session in progress
            </p>
            <h1 className="mt-1 text-base font-medium text-black dark:text-zinc-50">
              {details.session.assignmentTitle}
            </h1>
          </div>
          <div className="text-right">
            <p
              aria-live="off"
              className={`font-mono text-5xl tabular-nums leading-none ${
                warned
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-black dark:text-zinc-50"
              }`}
            >
              {formatCountdown(remainingMs ?? details.timeboxSec * 1000)}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
              remaining
            </p>
          </div>
        </div>
      </header>

      {warned && (
        <p
          role="status"
          className="shrink-0 border-b border-amber-300 bg-amber-50 px-6 py-2 text-center text-sm font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
        >
          Two minutes remaining.
        </p>
      )}

      <main
        ref={captionsScrollRef}
        className="mx-auto w-full min-h-0 max-w-3xl flex-1 overflow-y-auto px-6 py-8"
      >
        {phase === "connecting" && (
          <p className="text-sm text-zinc-500">
            Connecting to the Examiner. Allow microphone access when your
            browser asks.
          </p>
        )}
        {phase === "ending" && (
          <p className="text-sm text-zinc-500">Ending the Session…</p>
        )}

        {/*
          PRD §7 makes the captions the accessibility backstop for accents and
          for poor audio, so they have to reach a screen reader as they arrive:
          a labelled region alone is announced once, on focus, and never again.
        */}
        <section
          aria-label="Examiner captions"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          className="space-y-4"
        >
          {captions.length === 0 && phase === "live" && (
            <p className="text-sm text-zinc-500">
              The Examiner is about to speak. Answer out loud; you will not see
              captions of your own speech.
            </p>
          )}
          {captions.map((caption) => (
            <p
              key={caption.itemId}
              className="text-lg leading-8 text-zinc-900 dark:text-zinc-100"
            >
              {caption.text}
            </p>
          ))}
        </section>
      </main>

      <footer className="shrink-0 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-6">
          <p className="text-xs leading-5 text-zinc-500">
            Captions show the Examiner only. Your speech is transcribed but not
            shown here. No audio is stored.
          </p>
          {confirmingEnd ? (
            <div className="flex shrink-0 items-center gap-3">
              <button
                type="button"
                onClick={() => finish("student_request", 0)}
                className="rounded border border-red-600 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400"
              >
                End now
              </button>
              <button
                type="button"
                onClick={() => setConfirmingEnd(false)}
                className="text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-400"
              >
                Keep going
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={phase !== "live"}
              onClick={() => setConfirmingEnd(true)}
              className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200"
            >
              End Session
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-24 dark:bg-black">
      <main className="w-full max-w-2xl">{children}</main>
    </div>
  );
}

function BackLink() {
  return (
    <p className="mt-8">
      <Link
        href="/student"
        className="inline-block rounded bg-black px-4 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-black"
      >
        Back to your Assignment
      </Link>
    </p>
  );
}
