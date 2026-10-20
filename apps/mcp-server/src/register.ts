import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { toolErrorResult } from "./errors";
import { allTools } from "./tools";
import type { Logger } from "./logger";

export const SERVER_INFO = { name: "exam-sprint", version: "0.1.0" } as const;

/**
 * `registerTool` is generic over each tool's Zod schemas. With a heterogeneous tool list that
 * generic instantiation is too deep for the compiler (TS2589), so we register through this
 * loosely-typed view. Input validation still happens at runtime: the SDK validates arguments
 * against each tool's `inputSchema` before the callback runs.
 */
type RegisterTool = (
  name: string,
  config: object,
  callback: (input: unknown) => Promise<CallToolResult>,
) => unknown;

/** Build a fresh McpServer with every tool registered. Called once per HTTP request (stateless). */
export function createMcpServer(logger?: Logger): McpServer {
  const server = new McpServer(SERVER_INFO);
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const tool of allTools) {
    register(tool.name, { ...tool.config, _meta: { status: tool.status } }, async (input) => {
      try {
        return await tool.handler(input);
      } catch (error) {
        // Log the tool name and error class only: never inputs, which may hold student answers.
        logger?.warn("tool failed", {
          tool: tool.name,
          error: error instanceof Error ? error.name : "unknown",
        });
        return toolErrorResult(error);
      }
    });
  }
  return server;
}
