import {
  GRADER_USD_PER_INPUT_MTOK,
  GRADER_USD_PER_OUTPUT_MTOK,
} from "./constants";

/**
 * Conservative USD estimate from Responses API usage.
 * Cached input tokens are billed at the full input rate until the cost-model
 * ticket lands. Floor matches realtime spend ($0.01) so every call counts.
 */
export function estimateGraderSpendUsd(usage: {
  input_tokens?: number;
  output_tokens?: number;
} | null | undefined): number {
  const inputTokens = Math.max(0, usage?.input_tokens ?? 0);
  const outputTokens = Math.max(0, usage?.output_tokens ?? 0);
  const usd =
    (inputTokens / 1_000_000) * GRADER_USD_PER_INPUT_MTOK +
    (outputTokens / 1_000_000) * GRADER_USD_PER_OUTPUT_MTOK;
  return Math.max(0.01, Math.round(usd * 100) / 100);
}
