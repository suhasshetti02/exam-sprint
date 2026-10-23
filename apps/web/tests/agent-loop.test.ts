import { describe, expect, it } from "vitest";
import {
  MockLlmProvider,
  OpenAiCompatibleProvider,
} from "../lib/server/llm/providers";
import { runAgentTurn } from "../lib/server/llm/agent-loop";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";

describe("Milestone 4: LLM-Assisted Agent Orchestration", () => {
  it("handles a natural-language topic request, selects tools, and provides a grounded explanation", async () => {
    // 1. Script mock LLM to call search_study_notes and generate_quiz, then provide final conversational response
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "call-1",
            name: "search_study_notes",
            arguments: { query: "BCNF candidate key", limit: 2 },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [
          {
            id: "call-2",
            name: "generate_quiz",
            arguments: { conceptId: "bcnf", focus: "new" },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        content:
          "Boyce-Codd Normal Form is stricter than 3NF because it requires every determinant to be a superkey. Here is a question from your notes to test your understanding:",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "Can we practice BCNF? I find candidate keys confusing.",
      action: "start_session",
    });

    expect(result.providerUsed).toBe("llm");
    expect(result.question).toBeDefined();
    expect(result.question?.conceptId).toBe("bcnf");
    expect(result.evidence?.status).toBe("verified");
    expect(result.message).toContain("Boyce-Codd Normal Form");

    // Real tool traces recorded
    const toolNames = result.toolTraces.map((t) => t.tool);
    expect(toolNames).toContain("search_study_notes");
    expect(toolNames).toContain("generate_quiz");
    expect(result.toolTraces.every((t) => t.status === "success")).toBe(true);
  });

  it("handles a normal conversational response when no tool calls are needed", async () => {
    const mockProvider = new MockLlmProvider([
      {
        content:
          "Welcome to Exam Sprint! I can help you revise 1NF, 2NF, 3NF, BCNF, Functional Dependencies, and ACID transactions. Which topic would you like to tackle?",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "Hello tutor!",
      action: "start_session",
    });

    expect(result.providerUsed).toBe("llm");
    expect(result.message).toContain("Welcome to Exam Sprint!");
    expect(result.question).toBeUndefined();
    // Default mastery list loaded
    expect(result.masteryList.length).toBeGreaterThan(0);
  });

  it("handles answer evaluation and records progress via MCP tools", async () => {
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "call-eval",
            name: "evaluate_answer",
            arguments: { questionId: "q-1nf-1", answer: "atomic values and no repeating groups" },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [
          {
            id: "call-prog",
            name: "record_progress",
            arguments: {
              questionId: "q-1nf-1",
              answer: "atomic values and no repeating groups",
              verdict: "correct",
            },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        content:
          "Spot on! 1NF requires single atomic values and no repeating groups.",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "atomic values and no repeating groups",
      action: "submit_answer",
      questionId: "q-1nf-1",
    });

    expect(result.evaluation?.verdict).toBe("correct");
    expect(result.message).toContain("Spot on!");
    expect(result.toolTraces.map((t) => t.tool)).toContain("evaluate_answer");
    expect(result.toolTraces.map((t) => t.tool)).toContain("record_progress");
  });

  it("diagnoses misconceptions on incorrect answers and returns verified evidence", async () => {
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "call-eval",
            name: "evaluate_answer",
            arguments: { questionId: "q-norm-basics-1", answer: "slow queries and lock contention" },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [
          {
            id: "call-prog",
            name: "record_progress",
            arguments: {
              questionId: "q-norm-basics-1",
              answer: "slow queries and lock contention",
              verdict: "incorrect",
              misconceptionLabel: "confuses-anomalies-with-performance",
            },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        content:
          "Not quite. Normalization eliminates update, insertion and deletion anomalies, rather than addressing slow queries or locking.",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "slow queries and lock contention",
      action: "submit_answer",
      questionId: "q-norm-basics-1",
    });

    expect(result.evaluation?.verdict).toBe("incorrect");
    expect(result.evaluation?.misconceptionLabel).toBe("confuses-anomalies-with-performance");
    expect(result.evidence?.status).toBe("verified");
  });

  it("enforces trust boundary: model cannot fabricate a 'correct' verdict on an incorrect answer", async () => {
    // Model evaluates an incorrect answer, but attempts to call record_progress with verdict: 'correct'
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "call-eval",
            name: "evaluate_answer",
            arguments: { questionId: "q-norm-basics-1", answer: "wrong answer text" },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [
          {
            id: "call-prog-fake",
            name: "record_progress",
            arguments: {
              questionId: "q-norm-basics-1",
              answer: "wrong answer text",
              verdict: "correct", // FABRICATED VERDICT
            },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        content: "I processed your answer.",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "wrong answer text",
      action: "submit_answer",
      questionId: "q-norm-basics-1",
    });

    // The server evaluation must be 'incorrect'
    expect(result.evaluation?.verdict).toBe("incorrect");

    // The tool trace for record_progress must reflect the trusted evaluation ('incorrect'), not the model's 'correct'
    const recordTrace = result.toolTraces.find((t) => t.tool === "record_progress");
    expect(recordTrace).toBeDefined();
    expect(recordTrace?.arguments.verdict).toBe("incorrect");
  });

  it("enforces trust boundary: model cannot call record_progress without prior evaluate_answer", async () => {
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "call-arbitrary-progress",
            name: "record_progress",
            arguments: {
              questionId: "q-1nf-1",
              answer: "fake",
              verdict: "correct",
            },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        content: "Done.",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "I want free mastery",
      action: "start_session",
    });

    // The tool call was rejected due to trust boundary violation
    const recordTrace = result.toolTraces.find((t) => t.tool === "record_progress");
    expect(recordTrace).toBeUndefined(); // Never executed against MCP server
  });

  it("safely persists progress when model evaluates answer but terminates without calling record_progress", async () => {
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "call-eval",
            name: "evaluate_answer",
            arguments: { questionId: "q-2nf-1", answer: "partial dependencies" },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        // Model stops here without calling record_progress
        content: "Your answer is correct!",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "partial dependencies",
      action: "submit_answer",
      questionId: "q-2nf-1",
    });

    expect(result.evaluation?.verdict).toBe("correct");
    // Post-turn persistence should have called record_progress
    const recordTrace = result.toolTraces.find((t) => t.tool === "record_progress");
    expect(recordTrace).toBeDefined();
    expect(recordTrace?.status).toBe("success");
    expect(recordTrace?.arguments.verdict).toBe("correct");
  });

  it("strictly enforces maximum iteration limits to prevent runaway loops", async () => {
    // Model keeps calling a tool indefinitely
    const infiniteCalls = Array.from({ length: 10 }, (_, i) => ({
      toolCalls: [
        {
          id: `loop-${i}`,
          name: "get_mastery",
          arguments: { conceptIds: [`concept-${i}`] },
        },
      ],
      finishReason: "tool_calls" as const,
    }));

    const mockProvider = new MockLlmProvider(infiniteCalls);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "Review everything",
      action: "start_session",
      maxIterations: 3, // Bounded to 3
    });

    // Loop capped at 3 iterations
    expect(mockProvider.recordedMessages.length).toBe(3);
    expect(result).toBeDefined();
  });

  it("intercepts duplicate identical tool calls without re-executing", async () => {
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "dup-1",
            name: "get_mastery",
            arguments: {},
          },
        ],
        finishReason: "tool_calls",
      },
      {
        toolCalls: [
          {
            id: "dup-2",
            name: "get_mastery",
            arguments: {}, // Exact duplicate
          },
        ],
        finishReason: "tool_calls",
      },
      {
        content: "Completed reviewing your mastery.",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "Check my mastery",
      action: "start_session",
    });

    // get_mastery executed once in tool traces, duplicate intercepted
    const masteryTraces = result.toolTraces.filter((t) => t.tool === "get_mastery");
    expect(masteryTraces.length).toBe(1);
    expect(result.message).toBe("Completed reviewing your mastery.");
  });

  it("handles tool execution errors gracefully by informing the model", async () => {
    const mockProvider = new MockLlmProvider([
      {
        toolCalls: [
          {
            id: "err-call",
            name: "evaluate_answer",
            arguments: { questionId: "non-existent-q-id", answer: "test" },
          },
        ],
        finishReason: "tool_calls",
      },
      {
        content: "I could not locate that question ID in our database. Let's start with a new question.",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "Test",
      action: "submit_answer",
      questionId: "non-existent-q-id",
    });

    expect(result.message).toContain("could not locate that question ID");
  });

  it("drops questions with unverified evidence citations", async () => {
    const mockProvider = new MockLlmProvider([
      {
        content: "Here is an ungrounded question.",
        finishReason: "stop",
      },
    ]);

    const result = await runAgentTurn({
      provider: mockProvider,
      userMessage: "Invent a question",
      action: "start_session",
    });

    // Because no verified question was loaded from generate_quiz, question remains undefined
    expect(result.question).toBeUndefined();
    expect(result.evidence).toBeUndefined();
  });

  it("gracefully engages deterministic fallback when LLM provider encounters an error", async () => {
    const failingProvider = new MockLlmProvider();
    failingProvider.generateCompletion = async () => {
      throw new Error("Provider rate limited or network unreachable");
    };

    const orchestratorRes = await runTutoringOrchestration({
      action: "start_session",
      topic: "bcnf",
      customProvider: failingProvider,
    });

    // Succeeded via fallback
    expect(orchestratorRes.provider).toBe("deterministic_fallback");
    expect(orchestratorRes.question?.conceptId).toBe("bcnf");
    expect(orchestratorRes.evidence?.status).toBe("verified");
  });

  it("falls back to deterministic policy when no LLM provider is available", async () => {
    const orchestratorRes = await runTutoringOrchestration({
      action: "start_session",
      topic: "acid",
      customProvider: null as unknown as MockLlmProvider, // Explicitly no provider
    });

    expect(orchestratorRes.provider).toBe("deterministic_fallback");
    expect(orchestratorRes.question?.conceptId).toBe("acid");
    expect(orchestratorRes.evidence?.status).toBe("verified");
  });

  describe("OpenAiCompatibleProvider URL and Formatting Verification", () => {
    it("constructs the correct Gemini completions endpoint from base URL with trailing slash", () => {
      const provider = new OpenAiCompatibleProvider({
        apiKey: "AIzaFakeKeyForTest123456",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
      });

      expect(provider.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
      expect(provider.getCompletionsUrl()).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      );
      expect(provider.model).toBe("gemini-3.8-flash");
    });

    it("constructs the correct endpoint when /chat/completions is already present in baseUrl", () => {
      const provider = new OpenAiCompatibleProvider({
        apiKey: "AIzaFakeKeyForTest123456",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      });

      expect(provider.getCompletionsUrl()).toBe(
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      );
    });

    it("fails closed with clear error when configuration is ambiguous", () => {
      expect(() => {
        new OpenAiCompatibleProvider({
          apiKey: "custom-token-xyz-12345678",
          // No baseUrl and ambiguous generic model
          model: "my-custom-model",
        });
      }).toThrow(/Ambiguous LLM configuration/);
    });

    it("prevents sending Gemini credentials to an OpenAI URL due to model/endpoint mismatch", () => {
      expect(() => {
        new OpenAiCompatibleProvider({
          apiKey: "sk-openai-test-key-12345",
          baseUrl: "https://api.openai.com/v1",
          model: "gemini-3.8-flash",
        });
      }).toThrow(/Incompatible LLM configuration/);
    });

    it("safely routes modern Gemini tokens (AQ...) to Google endpoint even without explicit baseUrl", () => {
      const provider = new OpenAiCompatibleProvider({
        apiKey: "AQ.SyntheticGeminiKey9876543210",
        model: "gemini-3.8-flash",
      });
      expect(provider.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
      expect(provider.getCompletionsUrl()).toContain("generativelanguage.googleapis.com");
    });
  });
});

