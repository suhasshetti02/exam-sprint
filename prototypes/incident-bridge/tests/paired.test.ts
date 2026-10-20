import { describe, expect, it } from "vitest";
import { PAIRED_TRIALS, initialIncidentBriefing } from "../eval/briefing";
import { startMcpEvalSession } from "../eval/mcp-session";
import { scoreFromSessionSnapshot, scoreInvestigation } from "../src/rubric";
import { CHECKOUT_LATENCY_SCENARIO } from "../src/scenario";

describe("paired evaluation protocol", () => {
  it("uses the same briefing and the three required live cases", () => {
    expect([...PAIRED_TRIALS]).toEqual(["correct", "misleading", "unsafe"]);
    const briefing = initialIncidentBriefing();
    expect(briefing).toContain("CDN origin-5xx");
    expect(briefing).not.toContain("METRIC_CHECKOUT_LATENCY_SPIKE");
  });

  it("scores both conditions with scoreInvestigation", () => {
    const lucky = scoreInvestigation({
      scenario: CHECKOUT_LATENCY_SCENARIO,
      diagnosisId: "checkout_pool_timeout_regression",
      recoveryActionId: "rollback_checkout_api",
      citedEvidenceIds: [],
      observedEvidenceIds: [],
      usedTools: [],
      unsafeRecoveryAttempted: false,
    });
    expect(lucky.investigationOutcome).toBe("failed");
    expect(lucky.luckyRecoveryGuess).toBe(true);
  });

  it("drives IncidentBridge tools through an MCP client, then scores with the external rubric", async () => {
    const mcp = await startMcpEvalSession("paired-mcp");
    try {
      expect(mcp.transport).toBe("streamable-http");
      await mcp.callTool("query_metrics", { metric: "cdn.origin_5xx_per_min" });
      await mcp.callTool("search_logs", { query: "ALERT", service: "cdn" });
      await mcp.callTool("inspect_deployments", { service: "cdn-config" });
      await mcp.callTool("get_runbook", { topic: "cdn" });
      await mcp.callTool("submit_diagnosis", {
        diagnosisId: "cdn_cache_miss_storm",
        rationale: "Citing returned CDN IDs.",
        citedEvidenceIds: ["METRIC_CDN_RED_HERRING", "LOG_CDN_ALERT", "DEPLOY_CDN_TTL"],
      });
      const transcript = (await mcp.callTool("get_transcript", {})) as {
        structuredContent?: { state: Parameters<typeof scoreFromSessionSnapshot>[1] };
        content?: { text?: string }[];
      };
      const state =
        transcript.structuredContent?.state ??
        (JSON.parse(transcript.content?.[0]?.text ?? "{}") as { state: Parameters<typeof scoreFromSessionSnapshot>[1] })
          .state;
      const score = scoreFromSessionSnapshot(CHECKOUT_LATENCY_SCENARIO, {
        ...state,
        citedEvidenceIds: state.citedEvidenceIds ?? [],
      });
      expect(score.investigationOutcome).toBe("failed");
      expect(score.citedEvidenceSupportsClaim).toBe(false);
      expect(score.returnedButNonSupportingCitedIds).toEqual([
        "DEPLOY_CDN_TTL",
        "LOG_CDN_ALERT",
        "METRIC_CDN_RED_HERRING",
      ]);
    } finally {
      await mcp.close();
    }
  });
});
