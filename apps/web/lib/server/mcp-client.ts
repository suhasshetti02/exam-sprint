/**
 * Server-side MCP client service.
 * Makes real tools/list and tools/call requests over Streamable HTTP.
 * Keeps all tool calls server-side (never exposed to browser).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { getServerConfig } from "./config";

export interface ToolTraceEntry {
  tool: string;
  arguments: Record<string, unknown>;
  status: "success" | "error";
  durationMs: number;
  timestamp: string;
  summary?: string;
  error?: string;
}

const TIMEOUT_MS = 10000;

export async function executeMcpTool<TInput extends Record<string, unknown>, TOutput>(
  toolName: string,
  args: TInput,
): Promise<{ result: TOutput; trace: ToolTraceEntry }> {
  const { MCP_SERVER_URL } = getServerConfig();
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const client = new Client({ name: "exam-sprint-web", version: "0.1.0" });

  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL)), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const response = await client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      undefined,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );

    const durationMs = Date.now() - startTime;

    if (response.isError) {
      const errorText =
        (response.content as Array<{ type: string; text?: string }>)?.[0]?.text ??
        "Tool execution returned error";
      throw new Error(`MCP tool '${toolName}' failed: ${errorText}`);
    }

    let parsedResult: TOutput;
    if (response.structuredContent) {
      parsedResult = response.structuredContent as TOutput;
    } else {
      const rawText =
        (response.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? "{}";
      parsedResult = JSON.parse(rawText) as TOutput;
    }

    const trace: ToolTraceEntry = {
      tool: toolName,
      arguments: args,
      status: "success",
      durationMs,
      timestamp,
      summary: `Completed in ${durationMs}ms`,
    };

    return { result: parsedResult, trace };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const trace: ToolTraceEntry = {
      tool: toolName,
      arguments: args,
      status: "error",
      durationMs,
      timestamp,
      error: errorMessage,
    };
    throw Object.assign(new Error(errorMessage), { trace });
  } finally {
    await client.close().catch(() => undefined);
  }
}
