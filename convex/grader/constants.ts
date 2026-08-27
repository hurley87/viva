/**
 * Pinned 2026-08-27 against https://developers.openai.com/api/docs/models
 * GPT-5.6 Sol is the flagship text model ($4 / $20 per MTok).
 * Override with Convex env GRADER_MODEL if the lineup moves.
 */
export const GRADER_MODEL = "gpt-5.6-sol";

/** gpt-5.6-sol list prices as of 2026-08; used until the cost-model ticket lands. */
export const GRADER_USD_PER_INPUT_MTOK = 4;
export const GRADER_USD_PER_OUTPUT_MTOK = 20;

export function resolveGraderModel(): string {
  const fromEnv = process.env.GRADER_MODEL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : GRADER_MODEL;
}
