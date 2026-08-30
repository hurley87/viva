// The Assessment's shape, defined exactly once.
//
// This one Zod schema is BOTH the OpenAI strict structured-output schema on the
// Grader call AND the type the `assessments` row is written from. There is no
// parsing layer between the model and the database: whatever
// `responses.parse()` returns is already the stored shape, and
// {@link ASSESSMENT_MATCHES_TABLE} is a compile-time proof of that — it stops
// compiling the moment the schema and the table disagree.
//
// Why that matters beyond tidiness: the rating scale is the product. PRD §8
// fixes it at three levels plus `not_probed`, deliberately non-numeric, and the
// only way a rating outside that set can be stored is if the model is allowed
// to invent one. Under strict structured output the enum is part of the JSON
// Schema the API itself enforces, so an out-of-enum rating is not rejected
// after the fact — it cannot be generated. No runtime check backs this up
// because none is needed, and a check that never fires is a check nobody
// maintains.
//
// Strict-mode constraints this schema is written to satisfy (see
// research/zod-openai-structured.md): every property is required, no bare
// `.optional()`, every object closed with `additionalProperties: false`, no
// `z.record`. Absence is expressed as an empty array, never as a missing key.

import { z } from "zod";
import type { Doc } from "../_generated/dataModel";

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

/**
 * The three-level qualitative scale, plus the fourth state a Session can
 * legitimately leave a Criterion in (PRD §8).
 *
 * `not_probed` is not a bad rating. It means the Session never reached the
 * Criterion — the Examiner did not get to it, or the time-box arrived first —
 * and recording that honestly is what keeps an unasked question from reading as
 * a failed answer.
 */
export const CRITERION_RATINGS = [
  "established",
  "partially_established",
  "not_established",
  "not_probed",
] as const;

export const criterionRatingSchema = z.enum(CRITERION_RATINGS);

export type CriterionRating = z.infer<typeof criterionRatingSchema>;

// ---------------------------------------------------------------------------
// The Assessment
// ---------------------------------------------------------------------------

/** One Criterion of the Standard, as the Grader rated it. */
export const assessedCriterionSchema = z.object({
  /** Copied verbatim from the Standard, so the Assessment reads in isolation. */
  name: z.string(),
  rating: criterionRatingSchema,
  /**
   * Verbatim spans of the Transcript that justify the rating. Empty is legal
   * and expected for `not_probed`.
   */
  evidence: z.array(z.string()),
});

/**
 * One Examiner turn the Grader believes supplied the Student's position
 * (INV-1). This is the audit half of the Assessment: the Grader evaluates the
 * Student and, independently, evaluates the Examiner that questioned them.
 */
export const inv1FlagSchema = z.object({
  /** The offending Examiner turn, verbatim. */
  quote: z.string(),
  /** Which of the INV-1 prohibitions it crossed, and how. */
  explanation: z.string(),
});

export const assessmentSchema = z.object({
  criteria: z.array(assessedCriterionSchema),
  /**
   * Written to the Student, in the second person. The only part of an
   * Assessment a Student ever sees (PRD §8).
   */
  formativeSummary: z.string(),
  /** Empty when the Examiner held the line, which is the expected case. */
  inv1Flags: z.array(inv1FlagSchema),
});

/** The Grader's output, and the stored Assessment. The same type. */
export type Assessment = z.infer<typeof assessmentSchema>;

export type AssessedCriterion = z.infer<typeof assessedCriterionSchema>;

export type Inv1Flag = z.infer<typeof inv1FlagSchema>;

/** The name the strict JSON Schema is registered under on the API call. */
export const ASSESSMENT_SCHEMA_NAME = "viva_assessment";

// ---------------------------------------------------------------------------
// Proof that the model's output IS the Convex row
// ---------------------------------------------------------------------------

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type StoredAssessment = Doc<"assessments">;

/**
 * A compile-time assertion that the structured-output type and the
 * `assessments` table's own types are the same types, field for field.
 *
 * If someone widens the rating union in `schema.ts`, or renames a field on
 * either side, this constant stops being assignable and `npm run typecheck`
 * fails. That is the whole mechanism keeping "one schema, no parsing layer"
 * true as the code changes.
 */
export const ASSESSMENT_MATCHES_TABLE: {
  criteria: Exact<
    Assessment["criteria"],
    NonNullable<StoredAssessment["criteria"]>
  >;
  formativeSummary: Exact<
    Assessment["formativeSummary"],
    NonNullable<StoredAssessment["formativeSummary"]>
  >;
  inv1Flags: Exact<
    Assessment["inv1Flags"],
    NonNullable<StoredAssessment["inv1Flags"]>
  >;
} = { criteria: true, formativeSummary: true, inv1Flags: true };

// ---------------------------------------------------------------------------
// Alignment with the Standard
// ---------------------------------------------------------------------------

/**
 * Force the Assessment's Criteria to be exactly the Standard's Criteria, in the
 * Standard's order.
 *
 * The rating enum is guaranteed by the API; the *set of Criteria* cannot be,
 * because Criterion names are Teacher-written strings and no JSON Schema can
 * enumerate them at call time. So the prompt asks for one entry per Criterion
 * and this closes the gap structurally:
 *
 *   - a Criterion the model omitted comes back as `not_probed` with no
 *     evidence, which is the truthful reading of "the Grader said nothing about
 *     it";
 *   - a Criterion the model invented is dropped, so no Assessment can rate a
 *     Student against something their Teacher never wrote.
 *
 * This is not a parsing layer — nothing is re-typed or re-validated here. It is
 * the join between two things only one of which the schema can constrain.
 */
export function alignToStandard(
  standardCriteria: ReadonlyArray<{ name: string }>,
  assessed: ReadonlyArray<AssessedCriterion>,
): AssessedCriterion[] {
  const byName = new Map<string, AssessedCriterion>();
  for (const criterion of assessed) {
    // First one wins: a duplicated name is the model repeating itself, and the
    // first pass is the one the prompt asked for.
    if (!byName.has(criterion.name)) {
      byName.set(criterion.name, criterion);
    }
  }
  return standardCriteria.map((criterion) => {
    const rated = byName.get(criterion.name);
    if (rated === undefined) {
      return { name: criterion.name, rating: "not_probed", evidence: [] };
    }
    return {
      name: criterion.name,
      rating: rated.rating,
      evidence: rated.evidence,
    };
  });
}
