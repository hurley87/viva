import type { RealtimeItem } from "@openai/agents/realtime";

export type TranscriptSpeaker = "student" | "examiner";
export type TranscriptTextStatus = "final" | "failed" | "truncated";

export type PersistableTranscriptItem = {
  itemId: string;
  orderKey: number;
  speaker: TranscriptSpeaker;
  text: string;
  textStatus: TranscriptTextStatus;
};

export function isSystemNoteText(text: string): boolean {
  return text.startsWith("[SYSTEM:");
}

function extractMessageText(
  item: Extract<RealtimeItem, { type: "message" }>,
): string {
  switch (item.role) {
    case "system":
      return item.content
        .map((part) => part.text)
        .join("")
        .trim();
    case "user":
      return item.content
        .map((part) => {
          if (part.type === "input_text") {
            return part.text;
          }
          if (part.type === "input_audio") {
            return part.transcript ?? "";
          }
          return "";
        })
        .join("")
        .trim();
    case "assistant":
      return item.content
        .map((part) => {
          if (part.type === "output_text") {
            return part.text;
          }
          if (part.type === "output_audio") {
            return part.transcript ?? "";
          }
          return "";
        })
        .join("")
        .trim();
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

export function historyToTranscriptItems(
  history: RealtimeItem[],
  options: {
    failedItemIds?: ReadonlySet<string>;
    truncatedItemIds?: ReadonlySet<string>;
  } = {},
): PersistableTranscriptItem[] {
  const failedItemIds = options.failedItemIds ?? new Set<string>();
  const truncatedItemIds = options.truncatedItemIds ?? new Set<string>();
  const items: PersistableTranscriptItem[] = [];

  history.forEach((item, orderKey) => {
    if (item.type !== "message") {
      return;
    }
    if (item.role === "system") {
      return;
    }

    const text = extractMessageText(item);
    if (isSystemNoteText(text)) {
      return;
    }

    if (item.role === "user") {
      const failed = failedItemIds.has(item.itemId);
      items.push({
        itemId: item.itemId,
        orderKey,
        speaker: "student",
        text: failed ? "" : text,
        textStatus: failed ? "failed" : "final",
      });
      return;
    }

    const truncated =
      item.status === "incomplete" || truncatedItemIds.has(item.itemId);
    if (!truncated && text.length === 0) {
      return;
    }

    items.push({
      itemId: item.itemId,
      orderKey,
      speaker: "examiner",
      text,
      textStatus: truncated ? "truncated" : "final",
    });
  });

  return items;
}

export function lastInProgressExaminerItemId(
  history: RealtimeItem[],
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (
      item &&
      item.type === "message" &&
      item.role === "assistant" &&
      item.status === "in_progress"
    ) {
      return item.itemId;
    }
  }
  return null;
}

export function transcriptionEventItemId(event: {
  type: string;
  item_id?: unknown;
  itemId?: unknown;
}): string | null {
  if (typeof event.item_id === "string" && event.item_id.length > 0) {
    return event.item_id;
  }
  if (typeof event.itemId === "string" && event.itemId.length > 0) {
    return event.itemId;
  }
  return null;
}
