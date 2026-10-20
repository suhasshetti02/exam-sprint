import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, SERVER_INFO } from "./register";
import { allTools } from "./tools";
import type { Logger } from "./logger";

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/healthz";

/**
 * Stateless Streamable HTTP: every POST gets its own McpServer + transport, so no
 * Mcp-Session-Id is issued and nothing is kept in memory between requests. Student state
 * will live in SQLite, keyed by an identity the server derives itself (never model-supplied).
 */
export function createApp(logger?: Logger) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get(HEALTH_PATH, (_req, res) => {
    res.json({
      status: "ok",
      server: SERVER_INFO,
      tools: allTools.map((t) => ({ name: t.name, status: t.status })),
    });
  });

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const server = createMcpServer(logger);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger?.error("mcp request failed", { error: error instanceof Error ? error.name : "unknown" });
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // Stateless mode has no server-initiated stream and no sessions to terminate.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res
      .status(405)
      .set("Allow", "POST")
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get(MCP_PATH, methodNotAllowed);
  app.delete(MCP_PATH, methodNotAllowed);

  // Centralised error handler (e.g. malformed JSON bodies).
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = typeof err === "object" && err && "status" in err && typeof err.status === "number" ? err.status : 500;
    res.status(status).json({ jsonrpc: "2.0", error: { code: status === 400 ? -32700 : -32603, message: status === 400 ? "Parse error" : "Internal server error" }, id: null });
  });

  return app;
}
