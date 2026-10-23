# Exam Sprint

An adaptive, voice-first exam tutor. A student asks for a focused revision session; the tutor
retrieves from their own notes, asks grounded questions, grades answers with a **verifiable
quotation from the source**, remembers misconceptions, and retests weak concepts in later sessions.

Built for the Amazon Developer Hackathon 2026, Alexa+ track. The web app is an Alexa+-style
simulation client; the tutoring tools live in a real, self-hosted MCP server (Streamable HTTP).

> **Local implementation status:** The app includes a self-hosted MCP server, an Alexa+-inspired web simulation, four distinct study goals, persistent local mastery, evidence-backed questions, and browser Web Speech API controls. Live Gemini calls, physical microphone behavior, public video availability, and direct Alexa+ integration are not claimed as verified here.

## Implementation status

- [x] npm-workspaces monorepo, strict TypeScript, shared Zod schemas
- [x] MCP server (official SDK, stateless Streamable HTTP, health endpoint)
- [x] Tool discovery: the five tool contracts are listed via `tools/list`
- [x] Web app shell and real web → MCP handshake (`/api/status`)
- [x] SQLite schema, migration runner and concept seed
- [x] Unit/integration tests, lint, type-check, CI workflow
- [x] Note chunking: heading-based splitter, stable IDs (`<documentId>#<slug>`)
- [x] SQLite chunk ingestion: idempotent upsert with SHA-256 content-hash
- [x] BM25 keyword retrieval (`Bm25Retriever` in `packages/core`)
- [x] Evidence verifier: normalised substring check with source offsets
- [x] `search_study_notes` MCP tool: returns real passages and BM25 scores
- [x] `generate_quiz`, `evaluate_answer`: deterministic question bank with verified quotations and rubrics
- [x] `get_mastery`, `record_progress`: SQLite-backed learning history, misconception diagnosis, retest scheduling
- [x] Server-side Next.js route handlers (`/api/session`) managing the tutoring session lifecycle
- [x] Server-side MCP client via official SDK (`StreamableHTTPClientTransport`) with live latency and execution tracing
- [x] Connected UI components: `ConversationPanel`, `QuizCard`, `EvidenceCard` (verified quotes with character offsets), `MasteryPanel`, and `ServerStatus`
- [x] Adaptive retesting: cross-session review prioritizes concepts with low mastery or diagnosed misconceptions
- [x] LLM provider adapter, bounded agent loop, structured tool calling, conversational explanations, and deterministic fallback
- [ ] Voice input/output (browser Web Speech API)

All five MCP tools are registered, tested, and wired to the interactive Next.js tutoring UI via server-side route handlers with verified evidence citations, persistent SQLite mastery tracking, and an intelligent bounded LLM agent loop.

## How the learning loop works

Choose one of four goals: **Teach me this material**, **Quiz me on a topic**, **Revise my weak concepts**, or **Help me study the full document**. Rapid-Fire is a separate timed practice mode. StudyFlow retrieves from the selected notes, shows supporting evidence, evaluates the learner's answer, records progress in local SQLite, and uses persisted attempts or open misconceptions to guide later review. Concepts with no attempts are shown as **Not assessed**.

The Alexa+ experience is simulated in the web client. The self-hosted MCP service is available locally over Streamable HTTP at `http://127.0.0.1:3001/mcp`; `/healthz` reports server health. Local tests and a local runtime handshake exercise protocol version `2025-11-25`. This does not establish a connection to Amazon's hosted Alexa+ service.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 5.9 · Tailwind CSS 4 · MCP TypeScript SDK 1.32.1
(spec 2025-11-25) · Express 5 · Zod 3 · SQLite via Node's built-in `node:sqlite` · Vitest 5 · ESLint 9.

## Prerequisites

- Node.js **22.12 or newer** (`.nvmrc` pins 22). The local readiness run used Node 24.14.0 and npm 11.9.0.
- npm 10+ (ships with Node).
- No key is required for the local deterministic tutor. A user-supplied key is required only for optional live Gemini-compatible responses.

## Install and run (Windows PowerShell)

```powershell
npm install
Copy-Item .env.example .env        # optional: defaults work without it
npm run db:init                    # creates data\local\exam-sprint.db, applies migration, seeds concepts AND note chunks

# Terminal 1: MCP server  -> http://127.0.0.1:3001/mcp  (health: /healthz)
npm run dev:mcp

# Terminal 2: web app     -> http://localhost:3000
npm run dev:web
```

Open http://localhost:3000. The "MCP server" panel shows the live tool list. Stop the MCP server and
reload to see the error state.

Inspect the MCP server independently with MCP Inspector (transport: Streamable HTTP, URL
`http://127.0.0.1:3001/mcp`):

```powershell
npm run inspect:mcp
```

## Checks

```powershell
npm run typecheck   # all workspaces + repo-level tests
npm run lint
npm test            # core, mcp-server, web, and repo-level tests
npm run build       # production build of the web app
npm run check       # typecheck + lint + test
```

## Layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js UI and route handlers (server-side MCP client) |
| `apps/mcp-server` | Stateless MCP server: tool registration, validation, errors, health |
| `packages/core` | Framework-free types, Zod schemas, interfaces |
| `data/sample-notes` | Original sample DBMS notes (not from any textbook) |
| `data/migrations`, `data/seed` | SQLite schema and the concept catalogue |
| `scripts/db-init.mjs` | Applies migrations and seeds concepts |
| `tests` | Repo-level tests: migrations and repository hygiene |
| `docs` | Database plan, friction-log template |

More: [ARCHITECTURE.md](ARCHITECTURE.md), [MCP_TOOLS.md](MCP_TOOLS.md), [CONTRIBUTING.md](CONTRIBUTING.md).

## LLM Provider Setup & Gemini Integration

Exam Sprint features an intelligent, bounded agent loop in `apps/web/lib/server/llm/` that orchestrates real MCP tools (`search_study_notes`, `get_mastery`, `generate_quiz`, `evaluate_answer`, and `record_progress`).

### Integration Status

| Component | Status | Details |
|---|---|---|
| **Agent Framework** | **Implemented** | Bounded multi-turn loop (max 5 iterations), duplicate call detection, citation verifier guardrail, server-side trust boundaries. |
| **Mocked Test Suite** | **Passing** | Comprehensive Vitest suite testing tool selection, grading, error recovery, ungrounded quote rejection, and fallback. Zero paid API calls. |
| **Real Provider Connection** | **Unverified (Pending Key)** | Ready for live Gemini API calls. Fully functional offline fallback active until credentials are configured. |

### Environment Configuration

To connect a live Google Gemini API key:
1. Create or edit `apps/web/.env.local` (this file is excluded from Git via `.gitignore`):
   ```env
   # --- Google Gemini OpenAI-compatible configuration ---
   LLM_API_KEY=your-gemini-api-key-here
   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
   LLM_MODEL=gemini-2.5-flash
   ```

2. Run the safe live-provider smoke test:
   ```powershell
   npm run test:smoke:provider
   ```
   This command sends a single minimal verification ping, displays the model and round-trip latency, and confirms connectivity without printing or logging your secret key.

### Seamless Offline Fallback & Security Boundaries

- **Deterministic Fallback**: If `LLM_API_KEY` is not set or empty, the server automatically uses the high-reliability **deterministic fallback tutor**. The entire application (quiz generation, note retrieval, rubric grading, mastery tracking, and UI) runs completely offline without any external API access.
- **Server-Only Credentials**: API keys remain strictly on the web server; they are never bundled into client JS, never sent to the browser, and never logged.
- **Model Untrusted for Grading**: The model cannot fabricate an answer evaluation or overwrite SQLite mastery scores. Evaluations are bound to genuine student submissions via `evaluate_answer`, and persistence occurs strictly through `record_progress`.
- **Verified Citations**: All source quotations emitted by or linked to questions are verified against note chunks using `DefaultEvidenceVerifier`. Questions with unverified evidence are discarded.

## Known limitations

- **Voice I/O** uses browser Web Speech APIs. Browser/microphone behavior and real speech output must be manually verified in the browser used for a demo.
- **Single-Learner Local State**: In local development, the system operates in single-learner mode (`local-student`) stored in SQLite. Multi-user authentication and tenant isolation are not yet implemented.
- **Testing**: The primary test suite (`npm test`) runs exclusively against mocked providers (`MockLlmProvider`) so that test runs are instant, free, and completely deterministic.
- **Experimental SQLite**: `node:sqlite` is marked experimental in Node 22 and emits a warning; the schema is plain SQLite and portable to other drivers.
- The MCP server has **no authentication** and binds to `127.0.0.1` by default. Do not expose it publicly.

## Next milestones

See "Recommended implementation sequence" in [ARCHITECTURE.md](ARCHITECTURE.md#implementation-sequence).

## License

The tracked `LICENSE` is an MIT template and still contains copyright/year placeholders. The repository is public; the owner should complete and review the license details before relying on it as the repository's open-source license.
