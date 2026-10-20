import { describe, expect, it } from "vitest";
import { ensureServerEnvLoaded } from "../lib/server/env";
import { getLlmProvider } from "../lib/server/llm/providers";

ensureServerEnvLoaded();

const isExplicitlyRequested = process.env.RUN_LIVE_LLM_TEST === "true";
const apiKey = (
  process.env.LLM_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  ""
).trim();

const isLiveConfigured =
  isExplicitlyRequested &&
  Boolean(apiKey && apiKey !== "replace-me" && !apiKey.startsWith("replace-me") && apiKey.length > 5);

describe("Live LLM Provider Smoke Test (Optional)", () => {
  // This test only executes when explicitly requested via RUN_LIVE_LLM_TEST=true and valid credentials
  it.skipIf(!isLiveConfigured)(
    "verifies a live model response against the configured Gemini/OpenAI provider",
    async () => {
      const provider = getLlmProvider();
      expect(provider).not.toBeNull();
      expect(provider!.isAvailable()).toBe(true);

      const startTime = Date.now();
      const completion = await provider!.generateCompletion([
        {
          role: "user",
          content: "Reply with the single word 'DBMS'.",
        },
      ]);
      const durationMs = Date.now() - startTime;

      expect(completion.content).toBeDefined();
      expect(typeof completion.content).toBe("string");
      expect(completion.content!.length).toBeGreaterThan(0);

      // Safe logging without leaking secrets
      console.log(
        `✓ Live LLM smoke test passed: model=${provider!.model}, finishReason=${completion.finishReason}, latency=${durationMs}ms`,
      );
    },
  );
});
