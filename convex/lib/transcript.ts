import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { transcriptSnapshotItemValidator } from "./validators";

/** Late ASR finals and hangup flushes may arrive after the Session ends. */
export const TRANSCRIPT_WRITE_GRACE_MS = 30_000;

export type TranscriptSnapshotItem = Infer<
  typeof transcriptSnapshotItemValidator
>;

export function transcriptWritesOpen(args: {
  session: Doc<"sessions">;
  timeboxSec: number;
  now: number;
}): boolean {
  const startedAt = args.session.startedAt ?? args.session._creationTime;
  if (
    args.now >
    startedAt + args.timeboxSec * 1000 + TRANSCRIPT_WRITE_GRACE_MS
  ) {
    return false;
  }
  if (
    args.session.endedAt !== undefined &&
    args.now > args.session.endedAt + TRANSCRIPT_WRITE_GRACE_MS
  ) {
    return false;
  }
  return true;
}

export async function upsertTranscriptSnapshot(
  ctx: MutationCtx,
  sessionId: Id<"sessions">,
  items: TranscriptSnapshotItem[],
): Promise<void> {
  for (const item of items) {
    if (item.itemId.length === 0) {
      continue;
    }

    const existing = await ctx.db
      .query("transcriptItems")
      .withIndex("by_session_item", (q) =>
        q.eq("sessionId", sessionId).eq("itemId", item.itemId),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("transcriptItems", {
        sessionId,
        itemId: item.itemId,
        orderKey: item.orderKey,
        speaker: item.speaker,
        text: item.text,
        textStatus: item.textStatus,
      });
      continue;
    }

    if (
      existing.orderKey === item.orderKey &&
      existing.speaker === item.speaker &&
      existing.text === item.text &&
      existing.textStatus === item.textStatus
    ) {
      continue;
    }

    await ctx.db.patch("transcriptItems", existing._id, {
      orderKey: item.orderKey,
      speaker: item.speaker,
      text: item.text,
      textStatus: item.textStatus,
    });
  }
}
