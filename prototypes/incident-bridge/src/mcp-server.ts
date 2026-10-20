import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpTools } from "./tools";

const SERVER_INFO = { name: "incident-bridge-poc", version: "0.1.0" } as const;
const PORT = Number(process.env.INCIDENT_BRIDGE_PORT ?? 3101);

type RegisterTool = (
  name: string,
  config: object,
  callback: (
    input: unknown,
  ) => Promise<{ content: { type: "text"; text: string }[]; structuredContent?: unknown; isError?: boolean }>,
) => unknown;

export function createMcpServer(): McpServer {
  const server = new McpServer(SERVER_INFO);
  const register = server.registerTool.bind(server) as unknown as RegisterTool;
  for (const tool of mcpTools) {
    register(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        _meta: { status: "implemented", prototype: "incident-bridge" },
      },
      async (input) => {
        try {
          const parsed = tool.inputSchema.parse(input);
          const data = tool.handler(parsed as never);
          return {
            structuredContent: data as Record<string, unknown>,
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "unexpected failure";
          const code = error instanceof Error && "code" in error ? String((error as { code: string }).code) : "internal";
          return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }] };
        }
      },
    );
  }
  return server;
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

  app.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      server: SERVER_INFO,
      tools: mcpTools.map((t) => t.name),
      mcpSessions: sessions.size,
    });
  });

  const handleMcp = async (req: express.Request, res: express.Response) => {
    const existingId = req.header("mcp-session-id");
    if (existingId && sessions.has(existingId)) {
      await sessions.get(existingId)!.transport.handleRequest(req, res, req.body);
      return;
    }

    if (req.method !== "POST") {
      res.status(400).json({ error: "missing mcp-session-id" });
      return;
    }

    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { server, transport });
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.delete(id);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", (req, res) => {
    void handleMcp(req, res);
  });
  app.get("/mcp", (req, res) => {
    void handleMcp(req, res);
  });
  app.delete("/mcp", (req, res) => {
    void handleMcp(req, res);
  });

  return app;
}

if (process.argv[1]?.endsWith("mcp-server.ts") || process.argv[1]?.endsWith("mcp-server.js")) {
  const app = createApp();
  app.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`IncidentBridge PoC MCP listening on http://127.0.0.1:${PORT}/mcp\n`);
  });
}
