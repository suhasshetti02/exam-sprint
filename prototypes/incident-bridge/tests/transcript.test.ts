import { describe, expect, it } from "vitest";
import { IncidentSession } from "../src/engine";

describe("auditable transcript", () => {
  it("records tool calls, observations, decisions, and actions in order", () => {
    const session = new IncidentSession();
    session.queryMetrics("checkout.p99_latency_ms");
    session.recordDecision("Inspect deploy next.");
    session.applyRecoveryAction("scale_checkout_replicas");
    const kinds = session.getTranscript().map((e) => `${e.kind}:${e.name}`);
    expect(kinds).toEqual([
      "tool_call:query_metrics",
      "observation:query_metrics",
      "decision:record_decision",
      "tool_call:apply_recovery_action",
      "action:apply_recovery_action",
    ]);
    expect(session.getTranscript()[0]?.ts).toBe("2026-10-18T16:40:01.000Z");
  });
});
