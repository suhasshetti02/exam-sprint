import type { ToolTraceEntry } from "../mcp-client";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface LlmCompletionResponse {
  content?: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  raw?: unknown;
}

/**
 * Server-only LLM Provider abstraction.
 * Completely decoupled from specific vendor SDKs and runtime frameworks.
 */
export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  isAvailable(): boolean;
  generateCompletion(
    messages: ChatMessage[],
    tools?: LlmToolDefinition[],
    signal?: AbortSignal,
  ): Promise<LlmCompletionResponse>;
}

export interface AgentLoopOptions {
  provider: LlmProvider;
  maxIterations?: number;
  timeoutMs?: number;
}

export interface AgentTurnResult {
  message: string;
  question?: {
    questionId: string;
    conceptId: string;
    kind: "multiple_choice" | "short_answer";
    prompt: string;
    choices?: string[];
    evidence: {
      chunkId: string;
      quote: string;
      status: "verified" | "unverified" | "rejected";
      start?: number;
      end?: number;
    };
  };
  evidence?: {
    chunkId: string;
    quote: string;
    status: "verified" | "unverified" | "rejected";
    start?: number;
    end?: number;
  };
  evaluation?: {
    verdict: "correct" | "partially_correct" | "incorrect";
    explanation: string;
    misconceptionLabel?: string;
    recoveryCitation?: {
      chunkId: string;
      quote: string;
      status: "verified" | "unverified" | "rejected";
      start?: number;
      end?: number;
    };
    misconceptionResolved?: boolean;
    resolvedMisconceptionLabel?: string;
    recoveryStatus?: "open" | "in_recovery" | "resolved";
  };
  masteryList: Array<{
    conceptId: string;
    mastery: number;
    attemptsCount: number;
    openMisconceptions: string[];
    nextReviewAt?: string;
  }>;
  toolTraces: ToolTraceEntry[];
  providerUsed: "llm" | "deterministic_fallback";
}
