import { describe, expect, it } from "vitest";
import { IncidentSession } from "../src/engine";
import { invokeTool, listTools, resetSession } from "../src/tools";

function correctPath(session: IncidentSession) {
  session.queryMetrics("checkout.p99_latency_ms");
  session.searchLogs("PoolTimeout", "checkout-api");
  session.inspectDeployments("checkout-api");
  session.getRunbook("pool");
  session.recordDecision("Rollback checkout-api; ignore CDN alert.");
  session.submitDiagnosis(
    "checkout_pool_timeout_regression",
    "v2.14.0 reduced pool timeout and checkout p99 rose immediately after.",
  );
  session.applyRecoveryAction("rollback_checkout_api");
  return session.score();
}

describe("reproducible scoring", () => {
  it("scores a complete evidence-backed investigation at 100 twice", () => {
    const a = correctPath(new IncidentSession());
    const b = correctPath(new IncidentSession());
    expect(a).toEqual(b);
    expect(a.score).toBe(100);
    expect(a.diagnosisSupportedByEvidence).toBe(true);
    expect(a.recoverySupportedByEvidence).toBe(true);
  });

  it("does not support a CDN diagnosis even when CDN artifacts are observed", () => {
    const session = new IncidentSession();
    session.queryMetrics("cdn.cache_hit_ratio");
    session.queryMetrics("cdn.origin_5xx_per_min");
    session.searchLogs("ALERT");
    session.inspectDeployments("cdn-config");
    session.getRunbook("cdn");
    const submitted = session.submitDiagnosis("cdn_cache_miss_storm", "CDN hit ratio dipped.");
    expect(submitted.supportedByEvidence).toBe(false);
    const score = session.score();
    expect(score.diagnosisSupportedByEvidence).toBe(false);
    expect(score.diagnosisId).toBe("cdn_cache_miss_storm");
  });

  it("does not treat a correct diagnosis as supported without required observations", () => {
    const session = new IncidentSession();
    session.submitDiagnosis("checkout_pool_timeout_regression", "Guessing from the title.");
    expect(session.score().diagnosisSupportedByEvidence).toBe(false);
  });
});

describe("MCP tool wrappers", () => {
  it("lists the investigation and audit tools", () => {
    expect(listTools().map((t) => t.name)).toEqual([
      "query_metrics",
      "search_logs",
      "inspect_deployments",
      "get_runbook",
      "record_decision",
      "apply_recovery_action",
      "submit_diagnosis",
      "get_transcript",
    ]);
  });

  it("routes tool calls through a named session", () => {
    resetSession("t1");
    const metrics = invokeTool("query_metrics", { sessionId: "t1", metric: "payments.p99_latency_ms" });
    expect("isError" in metrics && metrics.isError).toBeFalsy();
    const text = metrics.content[0]?.text ?? "";
    expect(text).toContain("payments.p99_latency_ms");
    expect(text).toContain("142");
  });
});
