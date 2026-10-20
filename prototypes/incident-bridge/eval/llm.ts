import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenAiTool } from "./mcp-session";

export interface LlmConfig {
  present: boolean;
  model: string;
  endpoint: string;
  apiKey: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: NativeToolCall[];
}

export interface NativeToolCall {
  id: string;
  name: string;
  arguments: string;
  raw?: unknown;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls: NativeToolCall[];
  raw: unknown;
}

function loadEnvFiles() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, "..", "..", "..");
  const candidates = [
    resolve(root, "apps", "web", ".env.local"),
    resolve(root, "apps", "web", ".env"),
    resolve(root, ".env.local"),
    resolve(root, ".env"),
    resolve(here, "..", ".env"),
  ];
  for (const path of candidates) {
    try {
      if (existsSync(path) && typeof process.loadEnvFile === "function") {
        process.loadEnvFile(path);
      }
    } catch {
      // ignore
    }
  }
}

export function loadLlmConfig(): LlmConfig {
  loadEnvFiles();
  const apiKey = (
    process.env.INCIDENT_BRIDGE_LLM_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();
  const present = Boolean(apiKey) && apiKey !== "replace-me" && !apiKey.startsWith("replace-me") && apiKey.length >= 6;
  const isGemini =
    apiKey.startsWith("AIza") || (process.env.LLM_BASE_URL || "").includes("generativelanguage.googleapis.com");
  const rawBase =
    process.env.LLM_BASE_URL ||
    (isGemini ? "https://generativelanguage.googleapis.com/v1beta/openai" : "https://api.openai.com/v1");
  const baseUrl = rawBase.split("?")[0]?.replace(/\/+$/, "") ?? "";
  const model = process.env.LLM_MODEL || (isGemini ? "gemini-2.5-flash" : "gpt-4o-mini");
  const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
  return { present, model, endpoint, apiKey: present ? apiKey : "" };
}

function toApiMessages(messages: ChatMessage[]) {
  return messages.map((message) => {
    const payload: Record<string, unknown> = { role: message.role, content: message.content };
    if (message.tool_call_id) payload.tool_call_id = message.tool_call_id;
    if (message.name) payload.name = message.name;
    if (message.tool_calls?.length) {
      payload.tool_calls = message.tool_calls.map((call) =>
        call.raw && typeof call.raw === "object"
          ? call.raw
          : {
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            },
      );
    }
    return payload;
  });
}

function parseToolCalls(message: {
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
  function_call?: { name?: string; arguments?: string };
}): NativeToolCall[] {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    return message.tool_calls
      .filter((call) => call.function?.name)
      .map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function!.name!,
        arguments: call.function?.arguments ?? "{}",
        raw: call,
      }));
  }
  if (message.function_call?.name) {
    return [
      {
        id: "call_0",
        name: message.function_call.name,
        arguments: message.function_call.arguments ?? "{}",
      },
    ];
  }
  return [];
}

export class LlmInfrastructureError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`LLM HTTP ${status}: ${body.slice(0, 400)}`);
    this.name = "LlmInfrastructureError";
    this.status = status;
  }
}

export async function chatCompletion(
  config: LlmConfig,
  messages: ChatMessage[],
  options: { temperature?: number; tools?: OpenAiTool[] } = {},
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: toApiMessages(messages),
    temperature: options.temperature ?? 0,
    max_tokens: 1200,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new LlmInfrastructureError(response.status, text);
  }
  const json = JSON.parse(text) as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        function_call?: { name?: string; arguments?: string };
      };
    }[];
  };
  const message = json.choices?.[0]?.message;
  if (!message) throw new Error("LLM returned empty choices");
  const toolCalls = parseToolCalls(message);
  const content = typeof message.content === "string" ? message.content : "";
  if (!content && toolCalls.length === 0) throw new Error("LLM returned empty content");
  return { content, toolCalls, raw: json };
}

export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`No JSON object in model output: ${text.slice(0, 240)}`);
  return JSON.parse(candidate.slice(start, end + 1));
}
