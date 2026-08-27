import type { AssessmentOutput } from "../../shared/assessmentSchema";
import { CRITERION_RATINGS } from "../../shared/assessmentSchema";

type NamedCriterion = { name: string };

const RATING_SET = new Set<string>(CRITERION_RATINGS);

/**
 * Denormalize Standard criterion names onto the Assessment and drop extras
 * the model invented. Missing names become not_probed.
 */
export function alignCriteriaToStandard(
  standardCriteria: NamedCriterion[],
  modelCriteria: AssessmentOutput["criteria"],
): AssessmentOutput["criteria"] {
  const byName = new Map(
    modelCriteria.map((criterion) => [criterion.name, criterion]),
  );

  return standardCriteria.map((criterion) => {
    const match = byName.get(criterion.name);
    if (match === undefined || !RATING_SET.has(match.rating)) {
      return {
        name: criterion.name,
        rating: "not_probed" as const,
        evidence: [],
      };
    }
    return {
      name: criterion.name,
      rating: match.rating,
      evidence: match.evidence,
    };
  });
}
