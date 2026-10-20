import type { Scenario } from "./types";

export function supportSetFor(scenario: Scenario, diagnosisId: string | null): Set<string> {
  const option = scenario.diagnoses.find((d) => d.id === diagnosisId);
  const required = option?.supportedWhenEvidenceIncludes ?? ["__never__"];
  return new Set(required.filter((id) => id !== "__never__"));
}

/** Independent of scoring weights: did cited IDs actually support the claim? */
export function analyzeCitations(input: {
  scenario: Scenario;
  diagnosisId: string | null;
  citedEvidenceIds: string[];
  observedEvidenceIds: string[];
}): {
  citedEvidenceSupportsClaim: boolean | null;
  returnedButNonSupportingCitedIds: string[];
  citedButNotReturnedIds: string[];
} {
  const cited = input.citedEvidenceIds;
  const observed = new Set(input.observedEvidenceIds);
  const support = supportSetFor(input.scenario, input.diagnosisId);
  const returnedButNonSupportingCitedIds = cited
    .filter((id) => observed.has(id) && !support.has(id))
    .sort();
  const citedButNotReturnedIds = cited.filter((id) => !observed.has(id)).sort();

  if (cited.length === 0) {
    return {
      citedEvidenceSupportsClaim: null,
      returnedButNonSupportingCitedIds,
      citedButNotReturnedIds,
    };
  }

  const idMatches = input.diagnosisId === input.scenario.groundTruth.diagnosisId;
  const includesAllRequired = support.size > 0 && [...support].every((id) => cited.includes(id));
  const allCitedWereReturned = cited.every((id) => observed.has(id));
  return {
    citedEvidenceSupportsClaim: idMatches && includesAllRequired && allCitedWereReturned,
    returnedButNonSupportingCitedIds,
    citedButNotReturnedIds,
  };
}
