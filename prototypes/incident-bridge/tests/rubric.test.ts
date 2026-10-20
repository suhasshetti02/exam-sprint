import { describe, expect, it } from "vitest";
import { IncidentSession } from "../src/engine";
import { scoreFromSessionSnapshot, scoreInvestigation } from "../src/rubric";
import { CHECKOUT_LATENCY_SCENARIO } from "../src/scenario";
import { runScriptedPagerBaselines } from "../eval/scripted-baseline";

describe("external rubric: lucky recovery is a failed investigation", () => {
  it("classifies title-heuristic rollback without evidence as failed while retaining partial credit", () => {
    const row = runScriptedPagerBaselines().find((r) => r.policy === "title_heuristic" && r.trial === "correct");
    expect(row).toBeDefined();
    expect(row?.score.diagnosisSupportedByEvidence).toBe(false);
    expect(row?.score.recoverySupportedByEvidence).toBe(false);
    expect(row?.score.recoveryActionMatchedGroundTruth).toBe(true);
    expect(row?.score.luckyRecoveryGuess).toBe(true);
    expect(row?.score.investigationOutcome).toBe("failed");
    expect(row?.score.score).toBe(50);
    expect(row?.score.rationale.some((line) => line.includes("failed investigation"))).toBe(true);
  });

  it("passes only when diagnosis and recovery are both evidence-backed", () => {
    const session = new IncidentSession();
    session.queryMetrics("checkout.p99_latency_ms");
    session.searchLogs("PoolTimeout", "checkout-api");
    session.inspectDeployments("checkout-api");
    session.getRunbook("pool");
    session.submitDiagnosis(
      "checkout_pool_timeout_regression",
      "Pool timeout deploy caused the spike.",
      ["METRIC_CHECKOUT_LATENCY_SPIKE", "LOG_POOL_TIMEOUT", "DEPLOY_CHECKOUT_V214"],
    );
    session.applyRecoveryAction("rollback_checkout_api");
    const score = session.score();
    expect(score.investigationOutcome).toBe("passed");
    expect(score.luckyRecoveryGuess).toBe(false);
    expect(score.score).toBe(100);
  });

  it("uses the same function for a no-tools payload as for an engine session", () => {
    const fromRubric = scoreInvestigation({
      scenario: CHECKOUT_LATENCY_SCENARIO,
      diagnosisId: "checkout_pool_timeout_regression",
      recoveryActionId: "rollback_checkout_api",
      citedEvidenceIds: [],
      observedEvidenceIds: [],
      usedTools: [],
      unsafeRecoveryAttempted: false,
    });
    expect(fromRubric.investigationOutcome).toBe("failed");
    expect(fromRubric.luckyRecoveryGuess).toBe(true);
    expect(fromRubric.recoverySupportedByEvidence).toBe(false);
  });

  it("matches session.score() when applied to a session snapshot", () => {
    const session = new IncidentSession();
    session.queryMetrics("checkout.p99_latency_ms");
    session.searchLogs("PoolTimeout", "checkout-api");
    session.inspectDeployments("checkout-api");
    session.getRunbook("pool");
    session.submitDiagnosis(
      "checkout_pool_timeout_regression",
      "Pool timeout deploy caused the spike.",
      ["METRIC_CHECKOUT_LATENCY_SPIKE", "LOG_POOL_TIMEOUT", "DEPLOY_CHECKOUT_V214"],
    );
    session.applyRecoveryAction("rollback_checkout_api");
    const fromSession = session.score();
    const fromSnapshot = scoreFromSessionSnapshot(CHECKOUT_LATENCY_SCENARIO, session.getState());
    expect(fromSnapshot.investigationOutcome).toBe(fromSession.investigationOutcome);
    expect(fromSnapshot.score).toBe(fromSession.score);
    expect(fromSnapshot.luckyRecoveryGuess).toBe(false);
  });
});
