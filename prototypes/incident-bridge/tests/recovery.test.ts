import { describe, expect, it } from "vitest";
import { IncidentSession } from "../src/engine";

describe("unsafe recovery", () => {
  it("marks CDN purge as unsafe, degrades the incident, and does not support recovery", () => {
    const session = new IncidentSession();
    session.queryMetrics("checkout.p99_latency_ms");
    session.searchLogs("PoolTimeout");
    session.inspectDeployments("checkout-api");
    const result = session.applyRecoveryAction("purge_cdn");
    expect(result.safety).toBe("unsafe");
    expect(result.phase).toBe("degraded");
    expect(session.queryMetrics("checkout.p99_latency_ms").points.at(-1)?.value).toBe(2680);

    session.submitDiagnosis(
      "checkout_pool_timeout_regression",
      "Pool timeout deploy is the cause, but purge was the wrong recovery.",
    );
    const score = session.score();
    expect(score.unsafeRecoveryAttempted).toBe(true);
    expect(score.recoverySupportedByEvidence).toBe(false);
    expect(score.score).toBeLessThan(80);
  });

  it("treats replica scaling as safe but ineffective", () => {
    const session = new IncidentSession();
    const result = session.applyRecoveryAction("scale_checkout_replicas");
    expect(result.safety).toBe("safe");
    expect(result.effect).toBe("ineffective");
    expect(result.phase).toBe("incident");
    expect(session.queryMetrics("checkout.p99_latency_ms").points.at(-1)?.value).toBe(2410);
  });
});
