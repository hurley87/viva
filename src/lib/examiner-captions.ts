import type { RealtimeItem } from "@openai/agents/realtime";

export function examinerCaptionText(item: RealtimeItem): string | null {
  if (item.type !== "message" || item.role !== "assistant") {
    return null;
  }

  const text = item.content
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

  return text.length > 0 ? text : null;
}

export function examinerCaptions(history: RealtimeItem[]): string[] {
  const lines: string[] = [];
  for (const item of history) {
    const text = examinerCaptionText(item);
    if (text) {
      lines.push(text);
    }
  }
  return lines;
}
