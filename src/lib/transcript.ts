// Turning the Realtime SDK's conversation history into Transcript rows, and
// getting them to Convex without losing any.
//
// Two rules govern everything here, both from the capture research
// (.scratch/viva-mvp/issues/03-transcript-capture-and-timebox.md):
//
//   1. Rows are derived from the SDK's *reconciled* history snapshots, keyed
//      by `itemId`. Never from concatenating raw deltas. The SDK has already
//      merged the late ASR finals and the barge-in truncations into that
//      snapshot; re-deriving the whole thing on every update is what makes a
//      transcript that arrives late, out of order, or never behave correctly
//      without any bookkeeping on our side.
//   2. Writes go out continuously, not at the end. The Transcript is the sole
//      Session record (ADR-0001), so a killed tab must cost at most the last
//      second of it — never the Session.
//
// This module is deliberately free of React and of Convex: it is the pure
// mapping plus a small debouncer, so it can be reasoned about (and, later,
// tested) without a browser or a deployment.

import type { RealtimeItem, TransportEvent } from "@openai/agents/realtime";

/** Mirrors the `transcriptItems` row the Convex `transcript.upsert` accepts. */
export type TranscriptRow = {
  itemId: string;
  orderKey: number;
  speaker: "student" | "examiner";
  text: string;
  textStatus: "final" | "failed" | "truncated";
};

/**
 * Turns the client knows were cut short by barge-in. The Examiner's unspoken
 * tail is removed from the transcript by the platform on purpose, so this is
 * the difference between "the Examiner said exactly this" and "the Examiner
 * was interrupted here" — a distinction the Grader needs.
 */
export type TurnMarks = {
  truncatedItemIds: ReadonlySet<string>;
};

/** The text of one history item, whichever content parts it happens to carry. */
function itemText(item: RealtimeItem): string {
  if (item.type !== "message" || item.role === "system") {
    return "";
  }
  return item.content
    .map((part) => {
      switch (part.type) {
        case "input_text":
        case "output_text":
          return part.text;
        case "input_audio":
        case "output_audio":
          // `input_audio.transcript` is `string | null` and
          // `output_audio.transcript` is optional as well as nullable: null
          // means the ASR pass has not returned, not that nothing was said.
          return part.transcript ?? "";
        default:
          return "";
      }
    })
    .join("")
    .trim();
}

/**
 * Derive the Transcript from a reconciled history snapshot.
 *
 * `orderKey` is the item's index in the snapshot. History only ever grows and
 * item ids are stable, so an item's index does not move — which is what lets
 * the server take the newest snapshot's position as authoritative without
 * risking a reshuffle.
 *
 * What is deliberately left out:
 *
 *   - tool calls (`end_session`) — machinery, not what was said;
 *   - `role: "system"` items — the `[SYSTEM: two minutes remaining]` notes are
 *     operator signals injected by this app, not part of the examination;
 *   - Examiner turns with no text yet — nothing was said, so there is nothing
 *     to record.
 *
 * What is deliberately kept:
 *
 *   - a Student turn with no text. The turn happened; its ASR final may be in
 *     flight, or may never come. It is stored with empty text and
 *     `textStatus: "failed"`, and upgraded in place if the text lands. Dropping
 *     it would hide a turn from the Grader entirely.
 */
export function toTranscriptRows(
  history: readonly RealtimeItem[],
  marks: TurnMarks,
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];

  history.forEach((item, index) => {
    if (item.type !== "message" || item.role === "system") {
      return;
    }
    const text = itemText(item);

    if (item.role === "assistant") {
      if (text.length === 0) {
        return;
      }
      const cut =
        marks.truncatedItemIds.has(item.itemId) || item.status === "incomplete";
      rows.push({
        itemId: item.itemId,
        orderKey: index,
        speaker: "examiner",
        text,
        textStatus: cut ? "truncated" : "final",
      });
      return;
    }

    rows.push({
      itemId: item.itemId,
      orderKey: index,
      speaker: "student",
      text,
      textStatus: text.length > 0 ? "final" : "failed",
    });
  });

  return rows;
}

/** Whether two derived snapshots are the same record, field for field. */
export function rowsEqual(
  a: readonly TranscriptRow[],
  b: readonly TranscriptRow[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((row, index) => {
    const other = b[index];
    return (
      row.itemId === other.itemId &&
      row.orderKey === other.orderKey &&
      row.speaker === other.speaker &&
      row.text === other.text &&
      row.textStatus === other.textStatus
    );
  });
}

/**
 * The raw transport events that mean "a turn just finished settling": an ASR
 * final landed, an ASR pass gave up, or the Examiner's audio was truncated by
 * barge-in. They are used as *triggers* — the row content still comes from the
 * next reconciled snapshot — except for the truncation, whose item id is the
 * only place the interruption is identified.
 */
export type TurnSignal =
  | { kind: "transcription_settled" }
  | { kind: "truncated"; itemId: string };

export function turnSignal(event: TransportEvent): TurnSignal | null {
  const raw = event as { type?: unknown; item_id?: unknown };
  if (typeof raw.type !== "string") {
    return null;
  }
  if (
    raw.type === "conversation.item.input_audio_transcription.completed" ||
    raw.type === "conversation.item.input_audio_transcription.failed"
  ) {
    return { kind: "transcription_settled" };
  }
  if (raw.type === "conversation.item.truncated") {
    return typeof raw.item_id === "string"
      ? { kind: "truncated", itemId: raw.item_id }
      : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

/** How the recorder gets rows to the server. */
export type TranscriptSender = (
  rows: readonly TranscriptRow[],
) => Promise<unknown>;

export type TranscriptRecorder = {
  /** Note the current state of the Transcript; sent within `debounceMs`. */
  record: (rows: readonly TranscriptRow[]) => void;
  /** Send whatever is pending right now. Safe to call at any time. */
  flush: () => void;
  /** Stop the timer, retries included. Does not send. */
  dispose: () => void;
};

/**
 * How many times a rejected write is tried again before the recorder gives up
 * on it. The delay grows linearly with the attempt, so the last one is roughly
 * `debounceMs * MAX_SEND_ATTEMPTS` after the first — long enough to outlast a
 * transient server error, short enough that it is over well inside the window
 * in which the server still accepts Transcript writes.
 */
const MAX_SEND_ATTEMPTS = 4;

/**
 * Batches snapshots into at most one write per `debounceMs`, and sends nothing
 * when nothing changed.
 *
 * The timer is armed by the *first* unsent change rather than reset by each
 * one, so a busy conversation still reaches the server every `debounceMs`
 * instead of being starved by continuous updates. That bound is the worst case
 * a tab crash can cost.
 *
 * A rejected send puts its rows back and arms the timer again, up to
 * {@link MAX_SEND_ATTEMPTS}. During a live Session the next snapshot would
 * supersede them anyway — but the write that matters most is the LAST one, the
 * flush issued as the Session ends, and after it no snapshot is ever coming.
 * Relying on "more snapshots will arrive" would lose the closing turns
 * permanently, and the Transcript is the sole Session record (ADR-0001).
 */
export function createTranscriptRecorder(
  send: TranscriptSender,
  debounceMs: number,
): TranscriptRecorder {
  let pending: readonly TranscriptRow[] | null = null;
  let lastSent: readonly TranscriptRow[] | null = null;
  let timer: number | null = null;
  let failedAttempts = 0;

  function arm(delayMs: number): void {
    if (timer === null) {
      timer = window.setTimeout(flush, delayMs);
    }
  }

  function flush(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    const rows = pending;
    pending = null;
    if (rows === null || rows.length === 0) {
      return;
    }
    if (lastSent !== null && rowsEqual(lastSent, rows)) {
      return;
    }
    lastSent = rows;
    void send(rows).then(
      () => {
        failedAttempts = 0;
      },
      () => {
        lastSent = null;
        // Newer rows supersede these — they are re-derived from the whole
        // history, so the newer snapshot already contains everything here.
        if (pending === null) {
          pending = rows;
        }
        failedAttempts += 1;
        if (failedAttempts < MAX_SEND_ATTEMPTS) {
          arm(debounceMs * failedAttempts);
        }
      },
    );
  }

  return {
    record(rows) {
      pending = rows;
      arm(debounceMs);
    },
    flush,
    dispose() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
