#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// 1. Attempt to load local environment configuration files safely
const candidatePaths = [
  resolve(root, "apps", "web", ".env.local"),
  resolve(root, "apps", "web", ".env"),
  resolve(root, ".env.local"),
  resolve(root, ".env"),
];

for (const p of candidatePaths) {
  try {
    if (existsSync(p) && typeof process.loadEnvFile === "function") {
      process.loadEnvFile(p);
    }
  } catch {
    // Ignore file load errors
  }
}

const apiKey = (
  process.env.LLM_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  ""
).trim();

if (!apiKey || apiKey === "replace-me" || apiKey.startsWith("replace-me") || apiKey.length < 6) {
  console.log(`
===================================================================
 [Exam Sprint] Live Provider Smoke Test: SKIPPED
===================================================================
 Reason: Real LLM credentials are not configured in apps/web/.env.local
 or environment variables.

 To configure live Gemini API integration:
   1. Create or edit apps/web/.env.local (excluded from Git):
      LLM_API_KEY=your-gemini-api-key
      LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
      LLM_MODEL=gemini-2.5-flash

   2. Run the live verification smoke test:
      npm run test:smoke:provider

 The application continues to run in offline mode using the
 reliable deterministic fallback tutoring policy.
===================================================================
`);
  process.exit(0);
}

// 2. Perform safe live call
const isGemini = apiKey.startsWith("AIza") || (process.env.LLM_BASE_URL || "").includes("generativelanguage.googleapis.com");
const rawBaseUrl = process.env.LLM_BASE_URL || (isGemini ? "https://generativelanguage.googleapis.com/v1beta/openai" : "https://api.openai.com/v1");
const baseUrl = rawBaseUrl.split("?")[0].replace(/\/+$/, "");
const model = process.env.LLM_MODEL || (isGemini ? "gemini-2.5-flash" : "gpt-4o-mini");
const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;

console.log(`Connecting to live provider at: ${endpoint} (model: ${model})`);

const startTime = Date.now();
try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word 'DBMS'." }],
      temperature: 0.1,
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(15000),
  });

  const durationMs = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`✗ Provider returned HTTP ${response.status}: ${errorText.slice(0, 300)}`);
    process.exit(1);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    console.error("✗ Provider returned 200 OK but content was empty.");
    process.exit(1);
  }

  console.log(`
===================================================================
 [Exam Sprint] Live Provider Smoke Test: PASSED (✓)
===================================================================
 Model: ${model}
 Latency: ${durationMs}ms
 Sample Response: "${content.replace(/\n+/g, " ").slice(0, 80)}"
 Verification: Real provider response successfully confirmed.
===================================================================
`);
  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`✗ Smoke test failed with exception: ${msg}`);
  process.exit(1);
}
