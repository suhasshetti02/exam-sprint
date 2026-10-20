import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../src/mcp-server";
import { resetSession } from "../src/tools";

export interface McpEvalHandle {
  url: string;
  transport: "streamable-http";
  listToolNames: () => Promise<string[]>;
  openaiTools: () => Promise<OpenAiTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

function asJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object") return schema as Record<string, unknown>;
  return { type: "object", properties: {} };
}

export async function startMcpEvalSession(sessionId: string): Promise<McpEvalHandle> {
  resetSession(sessionId);
  const app = createApp();
  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
  const address = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/mcp`;

  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: "incident-bridge-eval-client", version: "0.1.0" });
  await client.connect(transport);

  return {
    url,
    transport: "streamable-http",
    async listToolNames() {
      const result = await client.listTools();
      return result.tools.map((tool) => tool.name);
    },
    async openaiTools() {
      const result = await client.listTools();
      return result.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: asJsonSchema(tool.inputSchema),
        },
      }));
    },
    async callTool(name: string, args: Record<string, unknown>) {
      return client.callTool({ name, arguments: { sessionId, ...args } });
    },
    async close() {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
