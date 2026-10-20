import { ensureServerEnvLoaded } from "../env";
import type {
  ChatMessage,
  LlmCompletionResponse,
  LlmProvider,
  LlmToolDefinition,
  ToolCall,
} from "./types";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const OPENAI_BASE_URL = "https://api.openai.com/v1";
const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 30000;

export interface OpenAiCompatibleConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ProviderStatusInfo {
  configured: boolean;
  providerType: "llm" | "deterministic_fallback";
  model?: string;
}

/**
 * Lightweight, server-only provider using standard fetch with OpenAI-compatible chat completions API.
 * Compatible with Google Gemini (OpenAI-compatible endpoint), OpenAI, Groq, Ollama, and OpenRouter.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: OpenAiCompatibleConfig) {
    this.apiKey = config.apiKey.trim();
    this.timeoutMs = config.timeoutMs || TIMEOUT_MS;

    const envModel = process.env.LLM_MODEL;
    const requestedModel = (config.model || envModel || "").toLowerCase();

    // 1. Resolve baseUrl explicitly without blind guesswork
    let resolvedBaseUrl = config.baseUrl || process.env.LLM_BASE_URL;

    if (!resolvedBaseUrl) {
      if (requestedModel.includes("gemini")) {
        resolvedBaseUrl = GEMINI_BASE_URL;
      } else if (
        requestedModel.includes("gpt") ||
        requestedModel.startsWith("o1") ||
        requestedModel.startsWith("o3")
      ) {
        resolvedBaseUrl = OPENAI_BASE_URL;
      } else if (this.apiKey.startsWith("AIza") || this.apiKey.startsWith("AQ.")) {
        resolvedBaseUrl = GEMINI_BASE_URL;
      } else if (this.apiKey.startsWith("sk-") && !this.apiKey.startsWith("sk-ant")) {
        resolvedBaseUrl = OPENAI_BASE_URL;
      } else {
        // Fail closed: Never send credentials to default third-party endpoint when provider is ambiguous
        throw new Error(
          "Ambiguous LLM configuration: LLM_BASE_URL is not set and provider cannot be safely determined. Set LLM_BASE_URL explicitly to prevent credential misdirection.",
        );
      }
    }

    this.baseUrl = resolvedBaseUrl.split("?")[0]!.replace(/\/+$/, "");

    // 2. Validate provider & model compatibility
    const isGeminiEndpoint = this.baseUrl.includes("generativelanguage.googleapis.com");
    const isOpenAiEndpoint = this.baseUrl.includes("api.openai.com");

    this.model =
      config.model ||
      envModel ||
      (isGeminiEndpoint ? GEMINI_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL);

    const effectiveModelLower = this.model.toLowerCase();

    if (isOpenAiEndpoint && effectiveModelLower.includes("gemini")) {
      throw new Error(
        `Incompatible LLM configuration: Model '${this.model}' is a Gemini model, but baseUrl is configured for OpenAI ('${this.baseUrl}'). Routing aborted.`,
      );
    }

    if (
      isGeminiEndpoint &&
      (effectiveModelLower.includes("gpt") ||
        effectiveModelLower.startsWith("o1") ||
        effectiveModelLower.startsWith("o3"))
    ) {
      throw new Error(
        `Incompatible LLM configuration: Model '${this.model}' is an OpenAI model, but baseUrl is configured for Google Gemini ('${this.baseUrl}'). Routing aborted.`,
      );
    }
  }

  isAvailable(): boolean {
    return Boolean(
      this.apiKey &&
      this.apiKey !== "replace-me" &&
      !this.apiKey.startsWith("replace-me") &&
      this.apiKey.length > 5,
    );
  }

  /**
   * Constructs the full completions endpoint URL.
   * Handles base URLs that end with or without trailing slash or /chat/completions.
   */
  getCompletionsUrl(): string {
    return this.baseUrl.endsWith("/chat/completions")
      ? this.baseUrl
      : `${this.baseUrl}/chat/completions`;
  }

  async generateCompletion(
    messages: ChatMessage[],
    tools?: LlmToolDefinition[],
    signal?: AbortSignal,
  ): Promise<LlmCompletionResponse> {
    if (!this.isAvailable()) {
      throw new Error("LLM provider credentials are not configured or are invalid.");
    }

    const abortSignal = signal || AbortSignal.timeout(this.timeoutMs);

    // Format tools for standard OpenAI function-calling schema
    const formattedTools = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    // Format chat messages
    const formattedMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          tool_call_id: m.toolCallId || "call_default",
          name: m.name,
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant" as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id || `call_${tc.name}_${Date.now()}`,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === "string"
                  ? tc.arguments
                  : JSON.stringify(tc.arguments ?? {}),
            },
          })),
        };
      }
      return {
        role: m.role,
        content: m.content,
      };
    });

    const body: Record<string, unknown> = {
      model: this.model,
      messages: formattedMessages,
      temperature: 0.2,
      max_tokens: 1000,
    };

    if (formattedTools && formattedTools.length > 0) {
      body.tools = formattedTools;
    }

    const endpoint = this.getCompletionsUrl();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      // Never log or echo the API key in error messages
      throw new Error(`LLM provider HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }> | null;
          tool_calls?: Array<{
            id?: string;
            function?: {
              name?: string;
              arguments?: string | Record<string, unknown>;
            };
          }>;
        };
        finish_reason?: string;
      }>;
    };

    const choice = data.choices?.[0];
    if (!choice || !choice.message) {
      throw new Error("LLM provider returned empty completion choices.");
    }

    // Extract text content safely (string or content parts)
    let parsedContent: string | undefined;
    if (typeof choice.message.content === "string") {
      parsedContent = choice.message.content;
    } else if (Array.isArray(choice.message.content)) {
      parsedContent = choice.message.content
        .map((part) => (typeof part === "string" ? part : part?.text || ""))
        .join("");
    }

    // Extract tool calls if present (do not assume all provider responses contain tool calls)
    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls && Array.isArray(choice.message.tool_calls)) {
      for (let i = 0; i < choice.message.tool_calls.length; i++) {
        const tc = choice.message.tool_calls[i];
        if (!tc?.function?.name) continue;

        let parsedArgs: Record<string, unknown> = {};
        const rawArgs = tc.function.arguments;
        if (typeof rawArgs === "object" && rawArgs !== null) {
          parsedArgs = rawArgs;
        } else if (typeof rawArgs === "string") {
          try {
            parsedArgs = JSON.parse(rawArgs.trim() || "{}");
          } catch {
            parsedArgs = { _raw: rawArgs };
          }
        }

        toolCalls.push({
          id: tc.id || `call_${tc.function.name}_${i}`,
          name: tc.function.name,
          arguments: parsedArgs,
        });
      }
    }

    return {
      content: parsedContent || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: choice.finish_reason === "tool_calls" ? "tool_calls" : "stop",
      raw: data,
    };
  }
}

/**
 * Mock LLM Provider for unit and integration testing.
 * Allows deterministic scripting of model turns, tool selection, errors, and responses.
 */
export class MockLlmProvider implements LlmProvider {
  readonly id = "mock-llm";
  readonly model = "mock-tutor-v1";
  private responses: LlmCompletionResponse[];
  private currentIndex = 0;
  public recordedMessages: ChatMessage[][] = [];

  constructor(responses: LlmCompletionResponse[] = []) {
    this.responses = [...responses];
  }

  isAvailable(): boolean {
    return true;
  }

  setResponses(responses: LlmCompletionResponse[]): void {
    this.responses = [...responses];
    this.currentIndex = 0;
  }

  async generateCompletion(
    messages: ChatMessage[],
  ): Promise<LlmCompletionResponse> {
    this.recordedMessages.push([...messages]);

    if (this.currentIndex >= this.responses.length) {
      return {
        content: "I have reviewed your progress and notes.",
        finishReason: "stop",
      };
    }

    const resp = this.responses[this.currentIndex++]!;
    return resp;
  }
}

/**
 * Provider factory that inspects environment configuration.
 * Returns null if no live credentials are provided, safely triggering deterministic fallback.
 */
export function getLlmProvider(): LlmProvider | null {
  ensureServerEnvLoaded();

  // Guard: Normal test suite must never make live or paid API calls
  if (process.env.VITEST === "true" && process.env.RUN_LIVE_LLM_TEST !== "true") {
    return null;
  }

  const apiKey = (
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();

  if (!apiKey || apiKey === "replace-me" || apiKey.startsWith("replace-me") || apiKey.length < 6) {
    return null;
  }

  try {
    return new OpenAiCompatibleProvider({ apiKey });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Provider initialization failed";
    console.warn(`[LLM Security] Provider routing rejected: ${msg}. Safely falling back to deterministic tutor.`);
    return null;
  }
}

/**
 * Returns safe status information about the current provider configuration.
 * Never leaks or prints the secret key value.
 */
export function getProviderStatus(): ProviderStatusInfo {
  ensureServerEnvLoaded();

  const apiKey = (
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();

  const hasConfiguredKey = Boolean(
    apiKey &&
    apiKey !== "replace-me" &&
    !apiKey.startsWith("replace-me") &&
    apiKey.length > 5,
  );

  if (hasConfiguredKey) {
    try {
      const provider = new OpenAiCompatibleProvider({ apiKey });
      return {
        configured: true,
        providerType: "llm",
        model: provider.model,
      };
    } catch {
      return {
        configured: false,
        providerType: "deterministic_fallback",
      };
    }
  }

  return {
    configured: false,
    providerType: "deterministic_fallback",
  };
}
