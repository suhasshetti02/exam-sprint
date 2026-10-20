# Architecture

## Components

| Component | Responsibility | Must not |
|---|---|---|
| `apps/web` | UI; Next.js route handlers act as the **orchestrator** (will own the LLM loop and call MCP) | Hold the LLM key in the browser; talk to SQLite directly |
| `apps/mcp-server` | Exposes tools over MCP; validates input; owns SQLite access; derives student identity | Trust model-supplied identity or quotations |
| `packages/core` | Types, Zod contracts, interfaces shared by both apps | Import React, Next.js, Express, the MCP SDK or `node:*` |

## Web → MCP request flow

Implemented:
- `GET /api/status`: Handshake & live tool discovery (`tools/list` on MCP server).
- `GET /api/session`: Loads persistent learner mastery, attempt counts, and open misconceptions via `get_mastery`.
- `POST /api/session`: Orchestrator route handler validating student requests via Zod. Uses `runTutoringOrchestration` to dynamically select the bounded LLM agent loop when credentials are configured (`LLM_API_KEY`), or seamlessly fall back to the deterministic tutoring engine. Executes server-side MCP tool chains (`StreamableHTTPClientTransport`) without exposing MCP credentials or endpoints to the browser:
  - `start_session`: Agent loop calls `get_mastery` (checks current concept level), `search_study_notes` (finds relevant chunks), and `generate_quiz` (delivers question with verified quotation and character offsets).
  - `submit_answer`: Agent loop calls `evaluate_answer` (deterministic rubric evaluation, error diagnosis), `record_progress` (updates SQLite mastery, records attempt, stores diagnosed misconception), and re-queries `get_mastery` to present updated progress alongside conversational explanations.
  - Fallback: When no LLM key is configured, the deterministic orchestrator runs the exact same MCP tool flow reliably and offline.
  - Tracing: Every tool invocation logs duration, timestamp, arguments, and outcome into a live trace returned with each response.

Planned for Milestone 5:
- Browser voice I/O via Web Speech API.

**Transport and lifecycle.** Endpoint `POST /mcp`, Streamable HTTP, protocol version 2025-11-25.
The server is **stateless**: each request creates a new `McpServer` and transport, no `Mcp-Session-Id`
is issued, `GET`/`DELETE /mcp` return 405. Clients still perform the normal handshake (`initialize`,
`notifications/initialized`, `tools/list`, `tools/call`); the SDK client does this for us. Because no
state is held in the process, any durable state belongs in SQLite.

## Data flow

**Implemented (Milestones 1 & 2):**

1. **Ingestion.** `scripts/db-init.mjs` reads `data/sample-notes/*.md`, strips YAML
   front-matter, splits on `# Heading` lines, collapses whitespace, and upserts rows
   into `documents` and `chunks` via `INSERT OR IGNORE` + SHA-256 content-hash check.
   Chunk IDs are stable: `<documentId>#<heading-slug>`.
2. **Retrieval.** `packages/core/src/retriever.ts` implements `Bm25Retriever` (Okapi
   BM25, k1=1.5, b=0.75). The MCP server reads all chunks from SQLite on each
   `search_study_notes` call, builds an in-memory index, and returns the top-N hits.
3. **Evidence verification.** `packages/core/src/evidence-verifier.ts` implements
   `DefaultEvidenceVerifier`. It normalises both the chunk text and the claimed quote
   (collapse whitespace runs → single space, trim, lowercase) and finds the quote as a
   substring. On success it returns `status: "verified"` with approximate character
   offsets into the original chunk text.
4. **Question bank and quiz generation.** `data/seed/questions.json` seeds original DBMS
   questions for all 8 concepts. `scripts/db-init.mjs` gates storage behind evidence
   verification—questions with missing or invalid citations are rejected. `generate_quiz`
   serves questions filtered by concept and focus (`new`, `weak`, `review`), always including
   verified evidence citations with byte/character offsets.
5. **Deterministic answer evaluation.** `packages/core/src/evaluator.ts` provides
   `DeterministicAnswerEvaluator`. It scores multiple-choice and short-answer questions
   against explicit rubrics, accepted answer variants, and partial variants without LLM
   calls. When errors align with diagnosed failure modes, it tags specific misconception
   labels. `evaluate_answer` is strictly side-effect-free (no DB writes).
6. **Mastery and learning history persistence.** `apps/mcp-server/src/db/progress.ts`
   persists graded attempts into SQLite. It updates concept mastery deterministically
   (+0.25 on correct, +0.10 on partially_correct, -0.20 on incorrect, bounded in [0.0, 1.0]),
   tracks misconceptions, and schedules retests. When a concept is subsequently mastered,
   open misconceptions and pending retests are marked resolved.
7. **Cross-session state.** `get_mastery` queries persistent mastery and open misconceptions
   so subsequent tutoring sessions can retrieve learner state even after server restarts.

**Implemented (Milestone 4):**

8. **LLM Provider Interface & Bounded Agent Loop.** `apps/web/lib/server/llm/` provides a server-only `LlmProvider` contract and OpenAI-compatible adapter (`OpenAiCompatibleProvider`) built with native `fetch` (no external runtime SDKs in `packages/core` or the client browser).
9. **Bounded Tool Calling Loop.** `agent-loop.ts` runs a multi-step agent turn capped at 5 iterations. It validates tool arguments against Zod schemas, catches duplicate calls and infinite loops, verifies question quotations against note chunks using `DefaultEvidenceVerifier` before surfacing them, and ensures answer evaluations and mastery updates are performed exclusively by trusted MCP tools.
10. **Graceful Deterministic Fallback.** If `LLM_API_KEY` is absent, the orchestrator routes to the offline deterministic tutoring engine with zero user disruption.

**Planned (Future milestones):**

11. **Voice I/O & Alexa+ simulation.** Speech recognition and audio synthesis via browser Web Speech API.

## Trust boundaries and error handling

- **Browser ↔ web backend:** untrusted. Validate every request body with Zod.
- **Server-only LLM credentials:** API keys remain strictly in server-side route handlers. No LLM runtime SDKs or API keys are placed in `packages/core` or shipped to the browser.
- **Model untrusted for grading and evidence:** The model may propose questions and conversational explanations, but it cannot independently certify evidence, overwrite mastery scores, or bypass the trusted evaluator (`evaluate_answer`) and `record_progress` workflow.
- **Strict Evidence Verification:** All questions and factual quotes surfaced by the agent must pass `DefaultEvidenceVerifier` against actual note chunks; ungrounded citations are removed or rejected.
- **Loop Bounding & Anomaly Detection:** Agent loops are strictly capped at 5 iterations per request. Repeated duplicate tool calls and malformed JSON payloads are trapped and aborted safely.
- **Student identity & local dev strategy:** In local development, the system operates in single-learner mode using `'local-student'` stored in the SQLite `students` table.
  - *Limitations:* There is no multi-user authentication or tenant isolation yet. All local requests share the same mastery state. For production deployment, session tokens or OAuth headers must map callers to authenticated server-issued IDs.
  - The frontend is strictly prohibited from arbitrarily passing or overwriting mastery values. Mastery is computed solely on the server via deterministic scoring formulas.
- **Evaluation vs. Persistence boundary:** `evaluate_answer` is strictly a read-only grading query. Mastery updates, attempt persistence, and retest scheduling happen solely through `record_progress`.
- **Study notes:** untrusted data. They may contain instructions aimed at the model. Tools are least-privilege, and writes come from code.
- **Errors:** input that violates a tool's schema is rejected by the SDK (JSON-RPC error). Tool execution failures return `isError: true` with a short, safe message so the model can react. Logs carry tool names and error classes only, never answers, notes or keys.

## Why SQLite and keyword retrieval first

- One file, zero services, reproducible on any Windows laptop, and works offline for judges.
- A few dozen chunks do not need embeddings; BM25 is deterministic, testable, and explainable.
- Quote verification needs exact text anyway, so lexical retrieval fits the product's core promise.
- `node:sqlite` avoids a native build step. The schema is plain SQLite if you later prefer another driver.

## Deviations from the brief

- **`node:sqlite` instead of a third-party SQLite package** (avoids native compilation on Windows).
- **Zod 3.25** is used because it is inside the MCP SDK's accepted range (`^3.25 || ^4`). Zod 4 was not tried.
- **Tool registration uses a loosely typed wrapper** (see `apps/mcp-server/src/register.ts`) because the
  SDK's generic types were too deep for the compiler (TS2589) across a heterogeneous tool list. Runtime
  validation is unaffected.
- **`@exam-sprint/core` ships TypeScript source** (no build step); Next compiles it via `transpilePackages`
  and the MCP server runs through `tsx`. A production build/bundle for the MCP server is not set up yet.
- `.github/workflows/ci.yml` is included but has **not** been run on GitHub.

## Implementation sequence

1. ✅ `core`: chunker, BM25 index, `EvidenceVerifier` with unit tests.
2. ✅ MCP: implement `search_study_notes`, load sample notes into SQLite.
3. ✅ MCP: `generate_quiz` with a pre-generated, verified question bank, then `evaluate_answer`.
4. ✅ MCP: `record_progress` + `get_mastery` with persistent SQLite learning history & misconception diagnosis.
5. ✅ Orchestrator & Client: server-side Next.js route handlers (`/api/session`), official MCP SDK transport, live latency/tool tracing.
6. ✅ UI: wire quiz, evidence (verified quotes & offsets), mastery progress bars, weak concept retesting, and tool trace drawer to real results.
7. ✅ LLM adapter: server-only provider interface, bounded agent loop, structured MCP tool calling, conversational synthesis, evidence guardrail, and deterministic fallback.
8. Identity: multi-user authentication (currently single-learner 'local-student' strategy for local development).
9. Voice (browser Web Speech API), hosted deployment if free limits allow.

