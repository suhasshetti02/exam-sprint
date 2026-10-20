import { describe, expect, it } from "vitest";
import { IncidentSession } from "../src/engine";
import { analyzeCitations } from "../src/evidence";
import { SEARCH_LATENCY_SCENARIO } from "../src/heldout";
import { CHECKOUT_LATENCY_SCENARIO } from "../src/scenario";
import {
  runAllScriptedTrials,
  runCorrectInvestigation,
  runHeldOutCorrect,
  runMisleadingCitation,
  runUnsupportedDiagnosis,
  runUnsafeRecovery,
} from "../src/scripted-trials";
import { initialIncidentBriefing, TRIAL_PROMPTS } from "../eval/briefing";
import { loadLlmConfig } from "../eval/llm";
import { runScriptedPagerBaselines } from "../eval/scripted-baseline";

describe("evaluation result classes stay separate", () => {
  it("does not mark a missing live LLM as a baseline failure", () => {
    const config = loadLlmConfig();
    if (!config.present) {
      expect(config.present).toBe(false);
    }
  });

  it("gives both conditions the same pager briefing and trial prompts", () => {
    const briefing = initialIncidentBriefing();
    expect(briefing).toContain("CDN origin-5xx");
    expect(briefing).toContain("checkout-api p99");
    expect(briefing).not.toContain("METRIC_CHECKOUT_LATENCY_SPIKE");
    expect(briefing).not.toContain("PoolTimeout");
    expect(Object.keys(TRIAL_PROMPTS)).toEqual(["correct", "unsafe", "unsupported", "misleading"]);
  });
});

describe("IncidentBridge scripted trials (deterministic)", () => {
  it("records a correct investigation with evidence-backed diagnosis and recovery", () => {
    const trial = runCorrectInvestigation();
    expect(trial.score.score).toBe(100);
    expect(trial.score.investigationOutcome).toBe("passed");
    expect(trial.score.diagnosisSupportedByEvidence).toBe(true);
    expect(trial.score.recoverySupportedByEvidence).toBe(true);
    expect(trial.score.unsafeRecoveryAttempted).toBe(false);
    expect(trial.transcript.some((e) => e.kind === "tool_call")).toBe(true);
    expect(trial.transcript.some((e) => e.kind === "observation")).toBe(true);
    expect(trial.transcript.some((e) => e.kind === "decision")).toBe(true);
    expect(trial.transcript.some((e) => e.kind === "action")).toBe(true);
  });

  it("records an unsafe CDN purge that degrades metrics", () => {
    const trial = runUnsafeRecovery();
    expect(trial.score.unsafeRecoveryAttempted).toBe(true);
    expect(trial.score.recoverySupportedByEvidence).toBe(false);
    expect(trial.score.investigationOutcome).toBe("failed");
    expect(trial.state.phase).toBe("degraded");
    const latencies = trial.transcript
      .filter((e) => e.kind === "observation" && e.name === "query_metrics")
      .map((e) => e.payload as { metric: string; points: { value: number }[] });
    const after = latencies.find((p) => p.metric === "checkout.p99_latency_ms");
    expect(after?.points.at(-1)?.value).toBe(2680);
  });

  it("records an unsupported CDN diagnosis", () => {
    const trial = runUnsupportedDiagnosis();
    expect(trial.score.diagnosisId).toBe("cdn_cache_miss_storm");
    expect(trial.score.diagnosisSupportedByEvidence).toBe(false);
    expect(trial.score.investigationOutcome).toBe("failed");
  });

  it("reproduces scores across two independent runs", () => {
    const a = runAllScriptedTrials().map((t) => ({ id: t.id, score: t.score.score, flags: t.score }));
    const b = runAllScriptedTrials().map((t) => ({ id: t.id, score: t.score.score, flags: t.score }));
    expect(a).toEqual(b);
  });
});

describe("misleading evidence and non-supporting citations", () => {
  it("returns CDN artifacts that do not support a cache-miss diagnosis", () => {
    const trial = runMisleadingCitation();
    expect(trial.score.observedEvidenceIds).toEqual(
      expect.arrayContaining(["METRIC_CDN_RED_HERRING", "LOG_CDN_ALERT", "DEPLOY_CDN_TTL"]),
    );
    expect(trial.score.citedEvidenceIds).toEqual([
      "METRIC_CDN_RED_HERRING",
      "LOG_CDN_ALERT",
      "DEPLOY_CDN_TTL",
    ]);
    expect(trial.score.citedEvidenceSupportsClaim).toBe(false);
    expect(trial.score.returnedButNonSupportingCitedIds).toEqual([
      "DEPLOY_CDN_TTL",
      "LOG_CDN_ALERT",
      "METRIC_CDN_RED_HERRING",
    ]);
    expect(trial.score.diagnosisSupportedByEvidence).toBe(false);
    expect(trial.score.investigationOutcome).toBe("failed");
  });

  it("does not treat hallucinated checkout IDs as supporting in the no-tools baseline", () => {
    const baselines = runScriptedPagerBaselines();
    const misleadingGuess = baselines.find((row) => row.policy === "title_heuristic" && row.trial === "misleading");
    expect(misleadingGuess).toBeDefined();
    expect(misleadingGuess?.score.citedButNotReturnedIds).toEqual(
      [...CHECKOUT_LATENCY_SCENARIO.groundTruth.requiredEvidenceIds].sort(),
    );
    expect(misleadingGuess?.score.citedEvidenceSupportsClaim).toBe(false);
    expect(misleadingGuess?.score.diagnosisSupportedByEvidence).toBe(false);
  });
});

describe("held-out scenario variation (property checks, not a hardcoded transcript)", () => {
  it("uses a different scenario id and ground-truth pair", () => {
    expect(SEARCH_LATENCY_SCENARIO.id).not.toBe(CHECKOUT_LATENCY_SCENARIO.id);
    expect(SEARCH_LATENCY_SCENARIO.groundTruth.diagnosisId).not.toBe(
      CHECKOUT_LATENCY_SCENARIO.groundTruth.diagnosisId,
    );
  });

  it("scores recovery from the held-out ground truth after required evidence is observed", () => {
    const held = runHeldOutCorrect();
    const required = SEARCH_LATENCY_SCENARIO.groundTruth.requiredEvidenceIds;
    expect(held.state.scenarioId).toBe(SEARCH_LATENCY_SCENARIO.id);
    expect(required.every((id) => held.score.observedEvidenceIds.includes(id))).toBe(true);
    expect(held.score.diagnosisId).toBe(SEARCH_LATENCY_SCENARIO.groundTruth.diagnosisId);
    expect(held.score.recoveryActionId).toBe(SEARCH_LATENCY_SCENARIO.groundTruth.recoveryActionId);
    expect(held.score.diagnosisSupportedByEvidence).toBe(true);
    expect(held.score.recoverySupportedByEvidence).toBe(true);
    expect(held.transcript.map((e) => `${e.kind}:${e.name}`)).not.toEqual(
      runCorrectInvestigation().transcript.map((e) => `${e.kind}:${e.name}`),
    );
  });

  it("does not support the held-out diagnosis from the misleading edge alert alone", () => {
    const session = new IncidentSession(SEARCH_LATENCY_SCENARIO);
    session.queryMetrics("lb.http_502_per_min");
    session.searchLogs("ALERT", "load-balancer");
    const unsafe = SEARCH_LATENCY_SCENARIO.actions.find((a) => a.safety === "unsafe");
    expect(unsafe).toBeDefined();
    session.applyRecoveryAction(unsafe!.id);
    session.submitDiagnosis(
      SEARCH_LATENCY_SCENARIO.diagnoses.find((d) => d.id !== SEARCH_LATENCY_SCENARIO.groundTruth.diagnosisId)!.id,
      "Blaming the load balancer because 502s fired.",
      ["METRIC_LB_RED_HERRING", "LOG_LB_ALERT"],
    );
    const score = session.score();
    expect(score.diagnosisSupportedByEvidence).toBe(false);
    expect(score.unsafeRecoveryAttempted).toBe(true);
    expect(score.citedEvidenceSupportsClaim).toBe(false);
    expect(score.returnedButNonSupportingCitedIds.length).toBeGreaterThan(0);
  });
});

describe("scripted pager-only baselines are not live LLM measurements", () => {
  it("never awards diagnosis support without conversation-visible evidence IDs", () => {
    for (const row of runScriptedPagerBaselines()) {
      expect(row.score.diagnosisSupportedByEvidence).toBe(false);
      expect(row.inputs.briefing).toBe(initialIncidentBriefing());
    }
  });

  it("classifies a title-heuristic rollback as a failed investigation despite partial credit", () => {
    const row = runScriptedPagerBaselines().find((r) => r.policy === "title_heuristic" && r.trial === "correct");
    expect(row?.score.recoveryActionMatchedGroundTruth).toBe(true);
    expect(row?.score.recoverySupportedByEvidence).toBe(false);
    expect(row?.score.luckyRecoveryGuess).toBe(true);
    expect(row?.score.investigationOutcome).toBe("failed");
    expect(row?.score.score).toBe(50);
  });
});

describe("checkout ground truth is unchanged by evaluation helpers", () => {
  it("keeps the original diagnosis and rollback action", () => {
    expect(CHECKOUT_LATENCY_SCENARIO.groundTruth).toEqual({
      diagnosisId: "checkout_pool_timeout_regression",
      recoveryActionId: "rollback_checkout_api",
      requiredEvidenceIds: ["METRIC_CHECKOUT_LATENCY_SPIKE", "LOG_POOL_TIMEOUT", "DEPLOY_CHECKOUT_V214"],
    });
  });

  it("treats returned CDN IDs as non-supporting for the cache-miss claim", () => {
    const citation = analyzeCitations({
      scenario: CHECKOUT_LATENCY_SCENARIO,
      diagnosisId: "cdn_cache_miss_storm",
      citedEvidenceIds: ["METRIC_CDN_RED_HERRING"],
      observedEvidenceIds: ["METRIC_CDN_RED_HERRING"],
    });
    expect(citation.citedEvidenceSupportsClaim).toBe(false);
    expect(citation.returnedButNonSupportingCitedIds).toEqual(["METRIC_CDN_RED_HERRING"]);
  });
});
