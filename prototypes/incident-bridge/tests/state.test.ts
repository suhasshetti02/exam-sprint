import { describe, expect, it } from "vitest";
import { EngineError, IncidentSession } from "../src/engine";

describe("state consistency", () => {
  it("returns identical metric payloads until an action mutates the scenario", () => {
    const session = new IncidentSession();
    const first = session.queryMetrics("checkout.p99_latency_ms");
    const second = session.queryMetrics("checkout.p99_latency_ms");
    expect(second.points).toEqual(first.points);
    expect(second.phase).toBe("incident");

    session.applyRecoveryAction("rollback_checkout_api");
    const after = session.queryMetrics("checkout.p99_latency_ms");
    expect(after.phase).toBe("recovered");
    expect(after.points.at(-1)?.value).toBe(188);
    expect(after.points.slice(0, -1)).toEqual(first.points.slice(0, -1));
  });

  it("keeps historical logs while appending only the defined rollback line", () => {
    const session = new IncidentSession();
    const before = session.searchLogs("checkout");
    session.applyRecoveryAction("rollback_checkout_api");
    const after = session.searchLogs("checkout");
    expect(after.matches.slice(0, before.matches.length)).toEqual(before.matches);
    expect(after.matches.some((l) => l.message.includes("rollback to v2.13.3"))).toBe(true);
  });
});

describe("invalid actions", () => {
  it("rejects unknown recovery actions without changing phase", () => {
    const session = new IncidentSession();
    const before = session.getState();
    expect(() => session.applyRecoveryAction("reboot_the_building")).toThrow(EngineError);
    try {
      session.applyRecoveryAction("reboot_the_building");
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe("invalid_action");
    }
    expect(session.getState().phase).toBe(before.phase);
    expect(session.getState().recoveryActionId).toBeNull();
  });

  it("rejects a second recovery after a successful rollback", () => {
    const session = new IncidentSession();
    session.applyRecoveryAction("rollback_checkout_api");
    expect(() => session.applyRecoveryAction("scale_checkout_replicas")).toThrowError(/already recovered/);
    expect(session.getState().phase).toBe("recovered");
  });
});
