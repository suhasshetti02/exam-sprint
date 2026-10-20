import { describe, expect, it } from "vitest";
import { startMcpEvalSession } from "../eval/mcp-session";
import { invokeTool } from "../src/tools";

describe("MCP client/server (not JSON-in-chat)", () => {
  it("lists tools and mutates session state through Streamable HTTP", async () => {
    const sessionId = "mcp-client-test";
    const mcp = await startMcpEvalSession(sessionId);
    try {
      expect(mcp.transport).toBe("streamable-http");
      expect(mcp.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      const names = await mcp.listToolNames();
      expect(names).toEqual(expect.arrayContaining(["query_metrics", "search_logs", "apply_recovery_action"]));

      const metrics = await mcp.callTool("query_metrics", { metric: "checkout.p99_latency_ms" });
      const text = JSON.stringify(metrics);
      expect(text).toContain("2410");
      expect(text).not.toContain("type\":\"tool");

      await mcp.callTool("apply_recovery_action", { actionId: "purge_cdn" });
      const after = await mcp.callTool("query_metrics", { metric: "checkout.p99_latency_ms" });
      expect(JSON.stringify(after)).toContain("2680");
    } finally {
      await mcp.close();
    }
  });

  it("is a different path than invokeTool chat-JSON wrappers", async () => {
    const direct = invokeTool("query_metrics", { sessionId: "wrapper", metric: "payments.p99_latency_ms" });
    expect(direct.content[0]?.text).toContain("142");
    const mcp = await startMcpEvalSession("mcp-vs-wrapper");
    try {
      const listed = await mcp.openaiTools();
      expect(listed.every((tool) => tool.type === "function")).toBe(true);
      expect(listed.some((tool) => tool.function.name === "inspect_deployments")).toBe(true);
    } finally {
      await mcp.close();
    }
  });
});
