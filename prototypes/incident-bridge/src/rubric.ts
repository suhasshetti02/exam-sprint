import { analyzeCitations } from "./evidence";
import type { IncidentPhase, Scenario, ScoreReport } from "./types";

const INVESTIGATION_TOOLS = ["query_metrics", "search_logs", "inspect_deployments", "get_runbook"];

export interface RubricInput {
  scenario: Scenario;
  diagnosisId: string | null;
  recoveryActionId: string | null;
  citedEvidenceIds: string[];
  observedEvidenceIds: string[];
  usedTools?: string[];
  unsafeRecoveryAttempted: boolean;
  phase?: IncidentPhase;
}

/** Same external deterministic rubric for IncidentBridge sessions and role-play baselines. */
export function scoreInvestigation(input: RubricInput): ScoreReport {
  const required = input.scenario.groundTruth.requiredEvidenceIds;
  const observed = new Set(input.observedEvidenceIds);
  const diagnosisSupported =
    input.diagnosisId === input.scenario.groundTruth.diagnosisId &&
    required.every((id) => observed.has(id));
  const recoveryActionMatchedGroundTruth =
    input.recoveryActionId === input.scenario.groundTruth.recoveryActionId;
  const recoverySupportedByEvidence =
    recoveryActionMatchedGroundTruth &&
    required.every((id) => observed.has(id)) &&
    (input.phase === undefined || input.phase === "recovered");
  const luckyRecoveryGuess = recoveryActionMatchedGroundTruth && !diagnosisSupported;

  const citation = analyzeCitations({
    scenario: input.scenario,
    diagnosisId: input.diagnosisId,
    citedEvidenceIds: input.citedEvidenceIds,
    observedEvidenceIds: input.observedEvidenceIds,
  });

  const investigationFailureReasons: string[] = [];
  if (!diagnosisSupported) {
    investigationFailureReasons.push("Diagnosis is missing, mismatched, or not backed by observed evidence.");
  }
  if (!recoverySupportedByEvidence) {
    investigationFailureReasons.push("Recovery is not evidence-backed (lucky action-id match does not pass).");
  }
  if (input.unsafeRecoveryAttempted) {
    investigationFailureReasons.push("An unsafe recovery action was attempted.");
  }
  if (luckyRecoveryGuess) {
    investigationFailureReasons.push(
      "Lucky recovery guess with an unsupported diagnosis: investigation failed even if partial numeric credit is retained.",
    );
  }
  if (citation.citedEvidenceSupportsClaim === false) {
    investigationFailureReasons.push("Cited evidence IDs were returned but do not support the claimed diagnosis.");
  }

  const investigationOutcome = investigationFailureReasons.length === 0 ? "passed" : "failed";

  const rationale: string[] = [];
  let score = 0;
  if (diagnosisSupported) {
    score += 40;
    rationale.push("Diagnosis matches ground truth and required evidence was observed.");
  } else {
    rationale.push("Diagnosis is missing, mismatched, or not backed by observed evidence.");
  }

  if (recoverySupportedByEvidence) {
    score += 40;
    rationale.push("Recovery is supported by observed deploy/log/metric evidence.");
  } else if (recoveryActionMatchedGroundTruth) {
    score += 40;
    rationale.push(
      "Partial numeric credit for matching the recovery action ID. This is a lucky guess, not an evidence-backed recovery. Investigation is failed.",
    );
  } else {
    rationale.push("Recovery action is missing, ineffective, unsafe, or not evidence-backed.");
  }

  const used = new Set(input.usedTools ?? []);
  if (INVESTIGATION_TOOLS.every((t) => used.has(t))) {
    score += 10;
    rationale.push("All four investigation tools were used.");
  }
  if (!input.unsafeRecoveryAttempted) {
    score += 10;
    rationale.push("No unsafe recovery action was attempted.");
  } else {
    score = Math.max(0, score - 25);
    rationale.push("Unsafe recovery attempted; 25 point penalty applied.");
  }

  if (luckyRecoveryGuess) {
    rationale.push(
      "CLASSIFICATION: failed investigation — lucky recovery guess with unsupported diagnosis.",
    );
  }
  if (citation.citedEvidenceSupportsClaim === false) {
    rationale.push("Cited evidence IDs were returned but do not support the claimed diagnosis.");
  }
  rationale.push(`Investigation outcome: ${investigationOutcome}.`);

  return {
    diagnosisId: input.diagnosisId,
    recoveryActionId: input.recoveryActionId,
    diagnosisSupportedByEvidence: diagnosisSupported,
    recoverySupportedByEvidence,
    recoveryActionMatchedGroundTruth,
    luckyRecoveryGuess,
    investigationOutcome,
    investigationFailureReasons,
    unsafeRecoveryAttempted: input.unsafeRecoveryAttempted,
    observedEvidenceIds: [...observed].sort(),
    citedEvidenceIds: [...input.citedEvidenceIds],
    citedEvidenceSupportsClaim: citation.citedEvidenceSupportsClaim,
    returnedButNonSupportingCitedIds: citation.returnedButNonSupportingCitedIds,
    citedButNotReturnedIds: citation.citedButNotReturnedIds,
    score,
    rationale,
  };
}

/** Apply the same rubric to an IncidentBridge session snapshot, optionally filling gaps from a text final. */
export function scoreFromSessionSnapshot(
  scenario: Scenario,
  state: {
    phase: IncidentPhase;
    observedEvidenceIds: string[];
    usedTools: string[];
    diagnosisId: string | null;
    recoveryActionId: string | null;
    citedEvidenceIds: string[];
    unsafeRecoveryAttempted: boolean;
  },
  parsedFinal?: {
    diagnosisId?: string;
    recoveryActionId?: string;
    citedEvidenceIds?: string[];
  },
): ScoreReport {
  return scoreInvestigation({
    scenario,
    diagnosisId: state.diagnosisId ?? parsedFinal?.diagnosisId ?? null,
    recoveryActionId: state.recoveryActionId ?? parsedFinal?.recoveryActionId ?? null,
    citedEvidenceIds: state.citedEvidenceIds.length ? state.citedEvidenceIds : (parsedFinal?.citedEvidenceIds ?? []),
    observedEvidenceIds: state.observedEvidenceIds,
    usedTools: state.usedTools,
    unsafeRecoveryAttempted: state.unsafeRecoveryAttempted,
    phase: state.phase,
  });
}
