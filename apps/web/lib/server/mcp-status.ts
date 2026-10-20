import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ServerStatus, ToolSummary } from "../api-client";

const TIMEOUT_MS = 3000;

/**
 * Performs a real MCP handshake (initialize -> tools/list) against the MCP server.
 * The server is stateless, so a short-lived client per request is correct.
 * Server-only: do not import from client components.
 */
export async function getMcpStatus(url: string): Promise<ServerStatus> {
  const client = new Client({ name: "exam-sprint-web", version: "0.1.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const { tools } = await client.listTools(undefined, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const server = client.getServerVersion();
    const summaries: ToolSummary[] = tools.map((t) => {
      const status = t._meta?.["status"];
      return {
        name: t.name,
        description: t.description ?? "",
        status: status === "planned" || status === "implemented" ? status : "unknown",
      };
    });
    return {
      reachable: true,
      serverName: server?.name ?? "unknown",
      serverVersion: server?.version ?? "unknown",
      tools: summaries,
    };
  } catch {
    return {
      reachable: false,
      reason: "Could not reach the MCP server. Start it with `npm run dev:mcp` and reload.",
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
