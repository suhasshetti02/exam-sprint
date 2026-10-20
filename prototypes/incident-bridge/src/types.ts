export type IncidentPhase = "incident" | "degraded" | "recovered";

export type TranscriptKind = "tool_call" | "observation" | "decision" | "action" | "diagnosis" | "score";

export interface MetricPoint {
  ts: string;
  value: number;
}

export interface LogLine {
  ts: string;
  service: string;
  level: "info" | "warn" | "error";
  message: string;
  evidenceIds: string[];
}

export interface Deployment {
  id: string;
  ts: string;
  service: string;
  fromVersion: string;
  toVersion: string;
  changeSummary: string;
  evidenceIds: string[];
}

export interface RunbookSection {
  id: string;
  title: string;
  body: string;
  evidenceIds: string[];
}

export interface DiagnosisOption {
  id: string;
  label: string;
  supportedWhenEvidenceIncludes: string[];
}

export interface RecoveryActionDef {
  id: string;
  label: string;
  safety: "safe" | "unsafe";
  effect: "effective" | "ineffective";
  logService?: string;
  logMessage?: string;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  now: string;
  groundTruth: {
    diagnosisId: string;
    recoveryActionId: string;
    requiredEvidenceIds: string[];
  };
  metrics: Record<string, MetricPoint[]>;
  recoveredLatestMetrics: Record<string, number>;
  degradedLatestMetrics: Record<string, number>;
  logs: LogLine[];
  deployments: Deployment[];
  runbook: RunbookSection[];
  diagnoses: DiagnosisOption[];
  actions: RecoveryActionDef[];
  metricEvidence: Record<string, string[]>;
}

export interface TranscriptEvent {
  seq: number;
  ts: string;
  kind: TranscriptKind;
  name: string;
  payload: unknown;
}

export interface ScoreReport {
  diagnosisId: string | null;
  recoveryActionId: string | null;
  diagnosisSupportedByEvidence: boolean;
  recoverySupportedByEvidence: boolean;
  recoveryActionMatchedGroundTruth: boolean;
  luckyRecoveryGuess: boolean;
  investigationOutcome: "passed" | "failed";
  investigationFailureReasons: string[];
  unsafeRecoveryAttempted: boolean;
  observedEvidenceIds: string[];
  citedEvidenceIds: string[];
  citedEvidenceSupportsClaim: boolean | null;
  returnedButNonSupportingCitedIds: string[];
  citedButNotReturnedIds: string[];
  score: number;
  rationale: string[];
}
