import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TOOL_NAMES } from "@exam-sprint/core";
import { createApp } from "../src/app";

let http: Server;
let base: string;

beforeAll(async () => {
  http = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((r) => http.once("listening", () => r()));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => http.close(() => r()));
});

async function connect() {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

describe("health endpoint", () => {
  it("lists all five tools and marks them as implemented", async () => {
    const body = (await (await fetch(`${base}/healthz`)).json()) as {
      status: string;
      tools: { name: string; status: string }[];
    };
    expect(body.status).toBe("ok");
    expect(body.tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    expect(body.tools.every((t) => t.status === "implemented")).toBe(true);
  });
});

describe("MCP over Streamable HTTP", () => {
  it("negotiates protocol version 2025-11-25 when explicitly requested by client", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "alexa-client", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      result: {
        protocolVersion: string;
        serverInfo: { name: string; version: string };
        capabilities: Record<string, unknown>;
      };
    };
    expect(data.result.protocolVersion).toBe("2025-11-25");
    expect(data.result.serverInfo.name).toBe("exam-sprint");
  });

  it("defaults to latest protocol version 2025-11-25 for forward compatibility", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {
          protocolVersion: "2026-01-01",
          capabilities: {},
          clientInfo: { name: "future-client", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: { protocolVersion: string } };
    expect(data.result.protocolVersion).toBe("2025-11-25");
  });

  it("initializes and discovers the five tool contracts", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    const search = tools.find((t) => t.name === "search_study_notes");
    expect(search?.inputSchema.required).toContain("query");
    await client.close();
  });

  it("rejects input that violates the declared schema", async () => {
    const client = await connect();
    const result = await client
      .callTool({ name: "search_study_notes", arguments: { query: "x" } })
      .then((r) => ({ isError: r.isError === true, text: JSON.stringify(r.content) }))
      .catch((e: unknown) => ({ isError: true, text: String(e) }));
    expect(result.isError).toBe(true);
    expect(result.text.toLowerCase()).toMatch(/invalid|too_small|at least/);
    await client.close();
  });

  it("generate_quiz produces verified quiz questions over HTTP", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "generate_quiz",
      arguments: { conceptId: "2nf", count: 1 },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const parsed = JSON.parse(text) as {
      questions: Array<{
        questionId: string;
        evidence: { status: string; quote: string };
      }>;
    };
    expect(parsed.questions.length).toBe(1);
    expect(parsed.questions[0]?.evidence.status).toBe("verified");
    await client.close();
  });

  it("search_study_notes returns a JSON payload with a results array", async () => {
    const client = await connect();
    // The DB may or may not have chunks in the test environment.
    // Either way the result must be non-error and contain a 'results' key.
    const result = await client.callTool({
      name: "search_study_notes",
      arguments: { query: "normalization", limit: 3 },
    });
    // Not an error (tool executed successfully)
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const parsed = JSON.parse(text) as { results: unknown[] };
    expect(Array.isArray(parsed.results)).toBe(true);
    await client.close();
  });

  it("returns an error for an unknown tool", async () => {
    const client = await connect();
    const outcome = await client
      .callTool({ name: "does_not_exist", arguments: {} })
      .then((r) => r.isError === true)
      .catch(() => true);
    expect(outcome).toBe(true);
    await client.close();
  });

  it("answers GET /mcp with 405 in stateless mode", async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });

  it("rejects malformed JSON bodies without leaking internals", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/stack|node_modules/);
  });
});
