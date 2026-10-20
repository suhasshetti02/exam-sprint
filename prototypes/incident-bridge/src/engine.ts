import { analyzeCitations } from "./evidence";
import { scoreInvestigation } from "./rubric";
import { CHECKOUT_LATENCY_SCENARIO } from "./scenario";
import type {
  IncidentPhase,
  LogLine,
  MetricPoint,
  Scenario,
  ScoreReport,
  TranscriptEvent,
} from "./types";

export class EngineError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_action" | "invalid_state" | "invalid_input",
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export interface SessionState {
  scenarioId: string;
  phase: IncidentPhase;
  observedEvidenceIds: string[];
  usedTools: string[];
  diagnosisId: string | null;
  recoveryActionId: string | null;
  citedEvidenceIds: string[];
  unsafeRecoveryAttempted: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function applyLatest(points: MetricPoint[], latest: number | undefined): MetricPoint[] {
  if (latest === undefined || points.length === 0) return clone(points);
  const next = clone(points);
  const last = next[next.length - 1];
  if (last) last.value = latest;
  return next;
}

export class IncidentSession {
  private readonly scenario: Scenario;
  private phase: IncidentPhase = "incident";
  private seq = 0;
  private readonly transcript: TranscriptEvent[] = [];
  private readonly observed = new Set<string>();
  private readonly usedTools = new Set<string>();
  private extraLogs: LogLine[] = [];
  private diagnosisId: string | null = null;
  private citedEvidenceIds: string[] = [];
  private recoveryActionId: string | null = null;
  private unsafeRecoveryAttempted = false;

  constructor(scenario: Scenario = CHECKOUT_LATENCY_SCENARIO) {
    this.scenario = clone(scenario);
  }

  getScenario(): Scenario {
    return clone(this.scenario);
  }

  getState(): SessionState {
    return {
      scenarioId: this.scenario.id,
      phase: this.phase,
      observedEvidenceIds: [...this.observed].sort(),
      usedTools: [...this.usedTools].sort(),
      diagnosisId: this.diagnosisId,
      recoveryActionId: this.recoveryActionId,
      citedEvidenceIds: [...this.citedEvidenceIds],
      unsafeRecoveryAttempted: this.unsafeRecoveryAttempted,
    };
  }

  getTranscript(): TranscriptEvent[] {
    return clone(this.transcript);
  }

  queryMetrics(metric: string): { metric: string; phase: IncidentPhase; points: MetricPoint[] } {
    this.noteTool("query_metrics", { metric });
    const series = this.scenario.metrics[metric];
    if (!series) {
      throw new EngineError("not_found", `Unknown metric '${metric}'.`);
    }
    const points = this.pointsFor(metric, series);
    for (const id of this.scenario.metricEvidence[metric] ?? []) this.observe(id);
    const result = { metric, phase: this.phase, points };
    this.observeEvent("query_metrics", result);
    return clone(result);
  }

  searchLogs(query: string, service?: string): { query: string; matches: LogLine[] } {
    this.noteTool("search_logs", { query, service });
    if (query.trim().length < 2) {
      throw new EngineError("invalid_input", "Log query must be at least 2 characters.");
    }
    const needle = query.toLowerCase();
    const matches = [...this.scenario.logs, ...this.extraLogs].filter((line) => {
      if (service && line.service !== service) return false;
      return line.message.toLowerCase().includes(needle) || line.service.toLowerCase().includes(needle);
    });
    for (const line of matches) for (const id of line.evidenceIds) this.observe(id);
    const result = { query, matches };
    this.observeEvent("search_logs", { query, service, count: matches.length, matches });
    return clone(result);
  }

  inspectDeployments(service?: string) {
    this.noteTool("inspect_deployments", { service });
    const deployments = this.scenario.deployments
      .filter((d) => !service || d.service === service)
      .slice()
      .sort((a, b) => a.ts.localeCompare(b.ts));
    for (const d of deployments) for (const id of d.evidenceIds) this.observe(id);
    const result = { service: service ?? null, deployments };
    this.observeEvent("inspect_deployments", result);
    return clone(result);
  }

  getRunbook(topic?: string) {
    this.noteTool("get_runbook", { topic });
    const needle = topic?.toLowerCase().trim();
    const sections = this.scenario.runbook.filter((section) => {
      if (!needle) return true;
      return (
        section.id.toLowerCase().includes(needle) ||
        section.title.toLowerCase().includes(needle) ||
        section.body.toLowerCase().includes(needle)
      );
    });
    for (const section of sections) for (const id of section.evidenceIds) this.observe(id);
    const result = { topic: topic ?? null, sections };
    this.observeEvent("get_runbook", result);
    return clone(result);
  }

  recordDecision(statement: string) {
    if (statement.trim().length < 3) {
      throw new EngineError("invalid_input", "Decision statement must be at least 3 characters.");
    }
    this.record("decision", "record_decision", { statement });
    return { recorded: true, statement };
  }

  applyRecoveryAction(actionId: string) {
    this.noteTool("apply_recovery_action", { actionId });
    const action = this.scenario.actions.find((a) => a.id === actionId);
    if (!action) {
      throw new EngineError("invalid_action", `Action '${actionId}' is not a defined recovery action.`);
    }
    if (this.phase === "recovered") {
      throw new EngineError("invalid_state", "Incident already recovered; further recovery actions are rejected.");
    }

    if (action.safety === "unsafe") this.unsafeRecoveryAttempted = true;
    this.recoveryActionId = actionId;

    if (action.effect === "effective") {
      this.phase = "recovered";
      this.extraLogs.push({
        ts: this.scenario.now,
        service: action.logService ?? "checkout-api",
        level: "info",
        message: action.logMessage ?? "rollback to v2.13.3 complete; pool timeout restored to 200ms",
        evidenceIds: ["LOG_ROLLBACK_COMPLETE"],
      });
    } else if (action.safety === "unsafe") {
      this.phase = "degraded";
      this.extraLogs.push({
        ts: this.scenario.now,
        service: action.logService ?? "cdn",
        level: "warn",
        message:
          action.logMessage ??
          `unsafe action ${actionId} applied; origin load increased and checkout latency worsened`,
        evidenceIds: [],
      });
    } else {
      this.extraLogs.push({
        ts: this.scenario.now,
        service: action.logService ?? "checkout-api",
        level: "info",
        message: action.logMessage ?? `action ${actionId} applied; pool timeout still 30ms so latency is unchanged`,
        evidenceIds: [],
      });
    }

    const result = {
      actionId,
      safety: action.safety,
      effect: action.effect,
      phase: this.phase,
    };
    this.record("action", "apply_recovery_action", result);
    return clone(result);
  }

  submitDiagnosis(diagnosisId: string, rationale: string, citedEvidenceIds: string[] = []) {
    this.noteTool("submit_diagnosis", { diagnosisId, rationale, citedEvidenceIds });
    const option = this.scenario.diagnoses.find((d) => d.id === diagnosisId);
    if (!option) {
      throw new EngineError("invalid_input", `Unknown diagnosis '${diagnosisId}'.`);
    }
    this.diagnosisId = diagnosisId;
    this.citedEvidenceIds = [...citedEvidenceIds];
    const supported = this.diagnosisSupported(option.supportedWhenEvidenceIncludes);
    const citation = analyzeCitations({
      scenario: this.scenario,
      diagnosisId,
      citedEvidenceIds,
      observedEvidenceIds: [...this.observed],
    });
    const result = {
      diagnosisId,
      rationale,
      citedEvidenceIds,
      supportedByEvidence: supported,
      citedEvidenceSupportsClaim: citation.citedEvidenceSupportsClaim,
      returnedButNonSupportingCitedIds: citation.returnedButNonSupportingCitedIds,
    };
    this.record("diagnosis", "submit_diagnosis", result);
    return clone(result);
  }

  score(): ScoreReport {
    const report = scoreInvestigation({
      scenario: this.scenario,
      diagnosisId: this.diagnosisId,
      recoveryActionId: this.recoveryActionId,
      citedEvidenceIds: this.citedEvidenceIds,
      observedEvidenceIds: [...this.observed],
      usedTools: [...this.usedTools],
      unsafeRecoveryAttempted: this.unsafeRecoveryAttempted,
      phase: this.phase,
    });
    this.record("score", "score", report);
    return clone(report);
  }

  private diagnosisSupported(required: string[]): boolean {
    if (!this.diagnosisId) return false;
    if (this.diagnosisId !== this.scenario.groundTruth.diagnosisId) return false;
    return required.every((id) => this.observed.has(id));
  }

  private pointsFor(metric: string, series: MetricPoint[]): MetricPoint[] {
    if (this.phase === "recovered") {
      return applyLatest(series, this.scenario.recoveredLatestMetrics[metric]);
    }
    if (this.phase === "degraded") {
      return applyLatest(series, this.scenario.degradedLatestMetrics[metric]);
    }
    return clone(series);
  }

  private observe(id: string) {
    this.observed.add(id);
  }

  private noteTool(name: string, payload: unknown) {
    this.usedTools.add(name);
    this.record("tool_call", name, payload);
  }

  private observeEvent(name: string, payload: unknown) {
    this.record("observation", name, payload);
  }

  private record(kind: TranscriptEvent["kind"], name: string, payload: unknown) {
    this.seq += 1;
    const ts = new Date(Date.parse(this.scenario.now) + this.seq * 1000).toISOString();
    this.transcript.push({ seq: this.seq, ts, kind, name, payload: clone(payload) });
  }
}
