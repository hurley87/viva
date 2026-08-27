import { z } from "zod";

/**
 * Single source of truth for Assessment structured output.
 * Used as OpenAI strict structured-output schema (zodTextFormat) and as the
 * TypeScript shape persisted on `assessments` (criteria / summary / INV-1 flags).
 * Keep the four rating literals in sync with `convex/schema.ts`.
 */
export const CRITERION_RATINGS = [
  "established",
  "partially_established",
  "not_established",
  "not_probed",
] as const;

export const criterionRating = z.enum(CRITERION_RATINGS);

export const assessmentCriterionSchema = z.object({
  name: z.string(),
  rating: criterionRating,
  evidence: z.array(z.string()),
});

export const inv1FlagSchema = z.object({
  quote: z.string(),
  explanation: z.string(),
});

export const assessmentOutputSchema = z.object({
  criteria: z.array(assessmentCriterionSchema),
  formativeSummary: z.string(),
  inv1Flags: z.array(inv1FlagSchema),
});

export type CriterionRating = z.infer<typeof criterionRating>;
export type AssessmentCriterion = z.infer<typeof assessmentCriterionSchema>;
export type Inv1Flag = z.infer<typeof inv1FlagSchema>;
export type AssessmentOutput = z.infer<typeof assessmentOutputSchema>;
