import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import {
  sessionEndReasonValidator,
  sessionEndToolReasonValidator,
} from "./validators";

export type SessionEndToolReason = Infer<typeof sessionEndToolReasonValidator>;
export type SessionEndReason = Infer<typeof sessionEndReasonValidator>;

/** Rough gpt-realtime-2.1 both-ways estimate until the cost-model ticket lands. */
export const REALTIME_USD_PER_MINUTE = 0.5;

export function mapToolReasonToEndReason(
  reason: SessionEndToolReason,
): SessionEndReason {
  switch (reason) {
    case "timebox":
      return "timebox";
    case "dead_threads":
      return "examiner_ended";
    case "student_request":
      return "student_hangup";
    case "disconnected":
      return "disconnected";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

export function estimateRealtimeSpendUsd(durationMs: number): number {
  const minutes = Math.max(durationMs, 0) / 60_000;
  return Math.max(0.01, Math.round(minutes * REALTIME_USD_PER_MINUTE * 100) / 100);
}

export function countsAgainstCapsAtEnd(args: {
  session: Doc<"sessions">;
  endedAt: number;
  minDurationSec: number;
}): boolean {
  if (args.session.openaiCallId === undefined) {
    return false;
  }
  const startedAt = args.session.startedAt ?? args.session._creationTime;
  const durationMs = args.endedAt - startedAt;
  return durationMs >= args.minDurationSec * 1000;
}
