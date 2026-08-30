// The recorder's delivery guarantees — the part of this module a Session can
// lose its record to.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranscriptRecorder, type TranscriptRow } from "./transcript";

// The recorder schedules on `window`, as it does in the browser it runs in.
Object.defineProperty(globalThis, "window", {
  value: globalThis,
  writable: true,
  configurable: true,
});

const DEBOUNCE_MS = 1_000;

function row(itemId: string, text: string): TranscriptRow {
  return {
    itemId,
    orderKey: 0,
    speaker: "student",
    text,
    textStatus: "final",
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTranscriptRecorder", () => {
  it("batches into one write per debounce window", async () => {
    const send = vi.fn(() => Promise.resolve());
    const recorder = createTranscriptRecorder(send, DEBOUNCE_MS);

    recorder.record([row("a", "one")]);
    recorder.record([row("a", "one two")]);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith([row("a", "one two")]);
  });

  it("sends nothing when the snapshot has not changed", async () => {
    const send = vi.fn(() => Promise.resolve());
    const recorder = createTranscriptRecorder(send, DEBOUNCE_MS);

    recorder.record([row("a", "one")]);
    recorder.flush();
    await vi.advanceTimersByTimeAsync(0);
    recorder.record([row("a", "one")]);
    recorder.flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(send).toHaveBeenCalledTimes(1);
  });

  // The regression that matters: the LAST flush of a Session is issued as the
  // call closes, and no snapshot follows it. If a rejected write were only
  // retried by "the next snapshot", those closing turns would be gone — and
  // the Transcript is the sole Session record (ADR-0001).
  it("retries a rejected write with no further snapshots to carry it", async () => {
    const rows = [row("a", "the closing answer")];
    const send = vi
      .fn<(sent: readonly TranscriptRow[]) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("server said no"))
      .mockResolvedValue(undefined);
    const recorder = createTranscriptRecorder(send, DEBOUNCE_MS);

    recorder.record(rows);
    recorder.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    // No `record` in between: nothing else is coming.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(rows);
  });

  it("gives up rather than retrying a rejected write forever", async () => {
    const send = vi
      .fn<(sent: readonly TranscriptRow[]) => Promise<unknown>>()
      .mockRejectedValue(new Error("server said no"));
    const recorder = createTranscriptRecorder(send, DEBOUNCE_MS);

    recorder.record([row("a", "one")]);
    recorder.flush();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(send).toHaveBeenCalledTimes(4);
  });

  it("lets a newer snapshot supersede the rows a write dropped", async () => {
    const send = vi
      .fn<(sent: readonly TranscriptRow[]) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("server said no"))
      .mockResolvedValue(undefined);
    const recorder = createTranscriptRecorder(send, DEBOUNCE_MS);

    recorder.record([row("a", "one")]);
    recorder.flush();
    await vi.advanceTimersByTimeAsync(0);

    recorder.record([row("a", "one"), row("b", "two")]);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith([row("a", "one"), row("b", "two")]);
  });

  it("stops the timer on dispose", async () => {
    const send = vi.fn(() => Promise.resolve());
    const recorder = createTranscriptRecorder(send, DEBOUNCE_MS);

    recorder.record([row("a", "one")]);
    recorder.dispose();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 10);

    expect(send).not.toHaveBeenCalled();
  });
});
