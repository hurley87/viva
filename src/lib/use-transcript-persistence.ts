"use client";

import type { RealtimeItem } from "@openai/agents/realtime";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  historyToTranscriptItems,
  lastInProgressExaminerItemId,
  transcriptionEventItemId,
} from "./transcript-items";

const DEBOUNCE_MS = 1000;

type TransportLikeEvent = {
  type: string;
  item_id?: unknown;
  itemId?: unknown;
};

export function useTranscriptPersistence(sessionId: Id<"sessions">) {
  const upsertSnapshot = useMutation(api.transcripts.upsertSnapshot);
  const historyRef = useRef<RealtimeItem[]>([]);
  const failedItemIdsRef = useRef(new Set<string>());
  const truncatedItemIdsRef = useRef(new Set<string>());
  const timerRef = useRef<number | null>(null);
  const upsertRef = useRef(upsertSnapshot);

  useEffect(() => {
    upsertRef.current = upsertSnapshot;
  }, [upsertSnapshot]);

  const persistNow = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const items = historyToTranscriptItems(historyRef.current, {
      failedItemIds: failedItemIdsRef.current,
      truncatedItemIds: truncatedItemIdsRef.current,
    });
    if (items.length === 0) {
      return;
    }

    try {
      await upsertRef.current({ sessionId, items });
    } catch (error) {
      console.error("Failed to persist transcript", error);
    }
  }, [sessionId]);

  const schedulePersist = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void persistNow();
    }, DEBOUNCE_MS);
  }, [persistNow]);

  const onHistoryUpdated = useCallback(
    (history: RealtimeItem[]) => {
      historyRef.current = history;
      schedulePersist();
    },
    [schedulePersist],
  );

  const onAudioInterrupted = useCallback(() => {
    const interruptedId = lastInProgressExaminerItemId(historyRef.current);
    if (interruptedId) {
      truncatedItemIdsRef.current.add(interruptedId);
    }
    void persistNow();
  }, [persistNow]);

  const onAgentEnd = useCallback(() => {
    void persistNow();
  }, [persistNow]);

  const onTransportEvent = useCallback(
    (event: TransportLikeEvent) => {
      if (event.type === "conversation.item.input_audio_transcription.failed") {
        const itemId = transcriptionEventItemId(event);
        if (itemId) {
          failedItemIdsRef.current.add(itemId);
        }
        void persistNow();
        return;
      }
      if (
        event.type === "conversation.item.input_audio_transcription.completed"
      ) {
        const itemId = transcriptionEventItemId(event);
        if (itemId) {
          failedItemIdsRef.current.delete(itemId);
        }
        void persistNow();
      }
    },
    [persistNow],
  );

  useEffect(() => {
    const flushOnHide = () => {
      void persistNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushOnHide();
      }
    };
    window.addEventListener("pagehide", flushOnHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushOnHide);
      document.removeEventListener("visibilitychange", onVisibility);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [persistNow]);

  return {
    onHistoryUpdated,
    onAudioInterrupted,
    onAgentEnd,
    onTransportEvent,
    flushNow: persistNow,
  };
}
