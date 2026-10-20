# MCP tools

**All five MCP tools are implemented.** They are registered, discoverable via `tools/list`
(each carries `_meta.status = "implemented"`), validate input with the Zod schemas in
`packages/core/src/schemas.ts`, and return typed `structuredContent` and text payloads.

Conventions for every tool:
- Input is validated by the SDK against the declared schema. Violations are JSON-RPC errors.
- Execution failures return `isError: true` with `<code>: <message>` (`not_found`, `invalid_state`, `internal`).
- Student identity is derived by the server (defaulting to `'local-student'` for local development), never passed or overwritten by the caller.
- Any quotation in a result carries `status: verified | unverified | rejected`; all returned questions and evaluations carry `verified` citations with source character offsets.
- Evaluation and progress persistence are strictly separated. `evaluate_answer` is side-effect-free; `record_progress` updates SQLite learning history.

| Tool | Status |
|---|---|
| `search_study_notes` | **implemented** |
| `get_mastery` | **implemented** |
| `generate_quiz` | **implemented** |
| `evaluate_answer` | **implemented** |
| `record_progress` | **implemented** |

## search_study_notes
- **Purpose:** find note chunks relevant to a topic (first step of a session).
- **Input:** `{ query: string (2–300), limit?: int 1–10 = 5 }`
- **Output:** `{ results: [{ chunkId, documentId, heading, text, score }] }`
- **Failure:** empty results are success; unreadable index → `internal`.
- **Used for:** grounding every question and explanation.

## get_mastery
- **Purpose:** read persisted mastery and open misconceptions.
- **Input:** `{ conceptIds?: string[] (≤50) }` (omit for all concepts)
- **Output:** `{ concepts: [{ conceptId, mastery 0–1, attemptsCount, openMisconceptions[], nextReviewAt? }] }`
- **Failure:** unknown concept → `not_found`.
- **Used for:** choosing what to retest at the start of a later session.

## generate_quiz
- **Purpose:** produce grounded questions for a concept.
- **Input:** `{ conceptId, count?: 1–5 = 1, focus?: "new" | "weak" | "review" = "new" }`
- **Output:** `{ questions: [{ questionId, conceptId, kind, prompt, choices?, evidence }] }`
- **Validation expectation:** a question is returned only with verified evidence; otherwise it is regenerated or replaced by a fallback.
- **Failure:** unknown concept → `not_found`; no verifiable question possible → `invalid_state`.

## evaluate_answer
- **Purpose:** grade an answer and justify it from the notes.
- **Input:** `{ questionId, answer: string (1–2000) }`
- **Output:** `{ verdict, explanation, evidence, misconceptionLabel? }`
- **Failure:** unknown question → `not_found`. Must not change stored progress (read-only with respect to mastery).

## record_progress
- **Purpose:** persist an attempt, update mastery and misconceptions, schedule a retest.
- **Input:** `{ questionId, answer, verdict, misconceptionLabel? }`
- **Output:** `{ attemptId, mastery, nextReviewAt?, retestScheduled }`
- **Failure:** unknown question → `not_found`. Called by the orchestrator with a graded result, never from free-form model text.
