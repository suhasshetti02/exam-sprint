# StudyFlow Voice Tutor Acceptance & Stabilization Report

**Date**: 2026-10-20  
**Repository**: [exam-sprint](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint)  
**Location**: `C:\Users\sande\Downloads\exam-sprint-scaffold\exam-sprint-scaffold\exam-sprint`  
**Branch**: `main`  
**Git Commit Baseline**: `710651b`

---

## 1. Verified Baseline & MCP Protocol Compliance

### Active Workspace & Repository Verification
- **Path**: `C:\Users\sande\Downloads\exam-sprint-scaffold\exam-sprint-scaffold\exam-sprint`
- **Git Root**: `C:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint`
- **Git Branch**: `main`
- **Head Commit**: `710651b`
- **Status**: Uncommitted improvements cleanly preserved without discarding user work.

### MCP Server Compliance & Protocol Handshake (Port 3001)
- **Transport**: Stateless Streamable HTTP over `POST http://127.0.0.1:3001/mcp`
- **Server Identity**: `name: "exam-sprint"`, `version: "0.1.0"`
- **Negotiated Protocol**: `2024-11-05` (Streamable HTTP with `application/json, text/event-stream` client negotiation)
- **Registered Study Tools**:
  1. `search_study_notes`: Document-scoped and syllabus BM25 retrieval
  2. `get_mastery`: SQLite-persisted competency and open misconception tracking
  3. `generate_quiz`: Grounded question generation with verified character offsets
  4. `evaluate_answer`: Deterministic grading, misconception diagnosis, recovery citations
  5. `record_progress`: Spaced repetition updates, misconception resolution tracking

---

## 2. Interactive Source-Evidence Inspector (Feature Implementation)

Implemented a rich, interactive Source-Evidence Inspector inside [EvidenceCard.tsx](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/components/EvidenceCard.tsx):
- **Surrounding Passage Display**: Displays the actual chunk passage surrounding the verified quotation.
- **Exact Offset Highlighting**: Uses validated character offsets (`start`, `end`) to highlight the evidence span with `<mark>` styling:
  ```tsx
  {before}
  <mark data-testid="evidence-highlight-span">{highlighted}</mark>
  {after}
  ```
- **Robust Multi-Tier Fallback**:
  1. Exact offset match when `sourceContext.slice(start, end) === quote`.
  2. Recovered physical substring match when offsets are missing, shifted, or invalid.
  3. Safe quotation fallback without crashing when passage is missing or truncated.
- **Strict Verification Enforcement**: Never displays a "Verified quote" badge or success styling for unverified or rejected quotations.
- **Interactive Action Buttons Bar**:
  - `Explain simply`: Summarizes the verified concept in plain language.
  - `Give an example`: Generates a concrete illustrative example from the notes.
  - `Quiz me`: Dynamically launches targeted practice on the cited concept.

---

## 3. Confirmed Root Causes & Surgical Voice Loop Fixes

| Issue Identified | Root Cause | Surgical Fix |
|---|---|---|
| **Spoken Question Audio Cutoff** | V8 engine garbage-collected `SpeechSynthesisUtterance` instances mid-speech when reading long prompt + choices A–D (~15s), prematurely killing `onend` and speech audio. | Added `activeUtterancesRef = useRef<Set<SpeechSynthesisUtterance>>(new Set())` in [use-voice.ts](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/use-voice.ts) to retain active references until `onend`/`onerror`. Called `window.speechSynthesis.resume()` before speaking. |
| **Unreliable Progression & Skipping Questions** | `latestEvaluationRef.current` was updated solely via asynchronous React `useEffect`. When advancing to a new question, any utterance completion from the welcome speech saw stale evaluation data and fired `startAutoAdvance()`, advancing past the question immediately. | In [TutoringSession.tsx](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/components/TutoringSession.tsx), synchronously cleared `latestEvaluationRef.current = undefined;` inside `handleNextQuestion()`, `handleStartTopic()`, and `handleStartFromSetup()`. |
| **Document Metadata in Questions & Choices** | In [document-service.ts](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/server/document-service.ts), `extractCleanSentences` only rejected colons at the end of lines (`/:$/`). Lines with labels like `Subject: Database Management Systems.` or `Purpose: Sample notes...` ended in periods and exceeded 25 characters, polluting question prompts and distractors. | Added explicit filtering in `extractCleanSentences` to drop metadata patterns (`Subject:`, `Purpose:`, `Author:`, `Document Title:`, `Overview:`, `Sample notes:`, etc.), and added clean fallback to `kind: "short_answer"` with `choices: []` if 4 valid distractors cannot be formed. |
| **"Study Full Document" Search Failure** | In [tutoring-policy.ts](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/server/tutoring-policy.ts), selecting "Help me study the full document" set `rawTopic = "full_document"`. BM25 searched notes for the literal word "full_document", returning 0 hits and an error message instead of traversing document chunks. | Handled `isFullDocGoal` (`goal === "full_document"` or `rawTopic === "full_document"`) by querying chunks with `ORDER BY ordinal ASC` without querying BM25 for the literal string. For standard syllabus, mapped `full_document` to `normalization-basics`. |
| **Undifferentiated "Teach Me This Material"** | "Teach me this material" (`teach`) previously gave the same initial test question without first explaining the concept grounded in notes. | Structured `welcomeMsg` for `teach` in [tutoring-policy.ts](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/server/tutoring-policy.ts) to first present the core concept quote directly from the notes before presenting the comprehension check question. |
| **Inaccurate LLM Provider Status Reporting** | In [orchestrator.ts](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/server/llm/orchestrator.ts), when an unsupported or unresolvable topic was rejected deterministically before calling the LLM, `provider: "llm"` was erroneously returned. | Updated unresolvable topic rejection to return `provider: "deterministic_fallback"`. |
| **Follow-up Question Parsing** | Queries such as "What does 2NF mean?" or "What does this term mean?" were previously unhandled or fell through as unknown topic searches. | Added regex parsing in [voice-command-parser.ts](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/voice-command-parser.ts) for `what does (the term | this term)? [term] mean` to map to `ask_study_question`. |

---

## 4. Exact Files Modified & Added

1. [`apps/web/components/EvidenceCard.tsx`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/components/EvidenceCard.tsx):
   - Implemented interactive Source-Evidence Inspector with span highlighting, offset validation, safe fallback, and action buttons.
2. [`apps/web/components/TutoringSession.tsx`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/components/TutoringSession.tsx):
   - Wired `onExplainSimply`, `onGiveExample`, `onQuizMe` actions to EvidenceCard.
   - Synchronously reset `latestEvaluationRef.current = undefined;` to prevent question skips.
3. [`apps/web/lib/api-client.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/api-client.ts):
   - Extended `EvidenceData` and `QuestionData` with optional `sourceContext` and `sourceTitle`.
4. [`apps/web/lib/server/tutoring-policy.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/server/tutoring-policy.ts):
   - Attached `sourceContext` from `chunks` table to evidence objects.
   - Differentiated four learning goals: `teach`, `quiz`, `weak`, `full_document`.
5. [`apps/mcp-server/src/tools/generate_quiz.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/mcp-server/src/tools/generate_quiz.ts):
   - Attached `chunk.text` as `sourceContext` to generated question evidence.
6. [`apps/mcp-server/src/tools/evaluate_answer.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/mcp-server/src/tools/evaluate_answer.ts):
   - Attached `chunk.text` as `sourceContext` to evaluation evidence and recovery citations.
7. [`packages/core/src/domain.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/packages/core/src/domain.ts) & [`schemas.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/packages/core/src/schemas.ts):
   - Added optional `sourceContext` to `EvidenceReference` and `verifiedEvidenceSchema`.
8. [`apps/web/lib/use-voice.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/use-voice.ts):
   - Held `activeUtterancesRef` to prevent Chromium V8 mid-sentence garbage collection.
9. [`apps/web/lib/voice-command-parser.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/voice-command-parser.ts):
   - Added regex support for "what does [term] mean" -> `ask_study_question`.
10. [`apps/web/lib/server/document-service.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/server/document-service.ts):
    - Stripped metadata header lines in `extractCleanSentences`.
    - Added clean `short_answer` fallback when 4 valid distractors cannot be formed.
11. [`apps/web/lib/server/llm/orchestrator.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/lib/server/llm/orchestrator.ts):
    - Reports `provider: "deterministic_fallback"` on unresolved topic rejection.
12. [`apps/web/tests/evidence-inspector.test.tsx`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/tests/evidence-inspector.test.tsx):
    - 10 automated unit tests for exact offsets, recovered offsets, missing context, out-of-bounds offsets, special characters, and interactive action buttons.
13. [`apps/web/tests/four-learning-goals.test.ts`](file:///c:/Users/sande/Downloads/exam-sprint-scaffold/exam-sprint-scaffold/exam-sprint/apps/web/tests/four-learning-goals.test.ts):
    - 6 regression tests verifying all 4 learning goals and provider status.

---

## 5. Verification & Test Metrics

- **`npm test`**: **335 passed**, 0 failed, 1 skipped (Exit Code 0)
  - `@exam-sprint/web`: 215 passed
  - `@exam-sprint/mcp-server`: 28 passed
  - `@exam-sprint/core`: 74 passed
  - Root: 18 passed
- **`npm run typecheck`**: **0 errors** across all workspaces (Exit Code 0)
- **`npm run lint`**: **0 errors**, **0 warnings** (Exit Code 0)
- **`npm run build`**: **Compiled successfully** into Next.js static/dynamic pages (Exit Code 0)

---

## 6. Manual Chrome Verification Steps

1. Open Chrome and navigate to `http://localhost:3000`.
2. Select an active document (e.g. `STUDYFLOW TEST NOTES`) or click "Resume Session".
3. Verify the **Evidence from your notes** card renders as the **Source Evidence Inspector**:
   - Displays the surrounding passage with the exact verified quotation highlighted inside `<mark>` tags.
   - Shows the verified character offset badge (e.g. `Offsets: chars 81–131`).
   - Displays the three interactive buttons: **Explain simply**, **Give an example**, and **Quiz me**.
4. Click **Explain simply** — verify an explanation message appears in the chat transcript.
5. Click **Give an example** — verify an illustrative example is requested and displayed.
6. Click the Microphone icon, speak *"Select option A"*, and confirm it advances smoothly without audio cutoff or skipped questions.
