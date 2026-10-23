# StudyFlow — verified-flow demo recording plan

**Target export:** 2:45 (165 seconds); hard limit: 2:59 including title, pauses and transitions.

This is a recording plan, not a claim that a browser recording has been completed. The proposed path is a seeded, isolated **2NF misconception-recovery** session using the built-in `dbms-normalization` notes. The question bank, expected answers, evidence, MCP calls and recovery logic are present in the current checkout and covered by tests. The exact browser run remains a required manual check.

## Repository audit snapshot

- **Checkout:** repository root `exam-sprint`; branch `feat/tutor-experience`; latest commit `93a2e83` (`Intial commit`). The working tree is already dirty, with substantial modified and untracked work. Preserve it; this task changes documentation only.
- **Stack/startup:** npm workspaces; Next.js 16.4.2 / React 19.2; Express MCP server on port 3001 by default; `npm run dev:mcp` and `npm run dev:web` are the repository scripts. Node.js must be 22.12 or newer for built-in SQLite.
- **Learning features:** four goals (teach, topic quiz, weak review, full document), separate Rapid-Fire challenge, SQLite-backed single-learner progress, BM25 note search, question generation, deterministic evaluation and source-offset evidence verification.
- **LLM and UI status:** optional Gemini-compatible provider with a bounded tool-calling orchestrator and deterministic fallback. The current `/api/status` says the provider is configured; the selected document route is deterministic. Live Gemini generation was not exercised.
- **MCP:** stateless Streamable HTTP. Current health and web handshake both succeeded; five tools are registered. `apps/web/tests/integration.test.ts` and `apps/web/tests/document-retrieval.test.ts` pass in the focused run using isolated test data.
- **Current local state:** the default web and MCP listeners responded on ports 3000 and 3001. The default document library contains many duplicate uploads. The plan therefore uses the dedicated isolated DB and ports 3002/3003.

## Candidate and verification status

- **Document:** built-in `dbms-normalization` sample (six indexed note chunks in the running app's document API). Use the isolated database below so the many duplicate uploads in the current default library do not appear in the recording.
- **Goal:** **Revise my weak concepts**, with focus topic **2NF**. `db:demo-seed` establishes a real weak 2NF state: three attempts, 33% mastery, and open misconception `confuses-2nf-with-3nf`.
- **First question expected:** “When is a table considered to be in second normal form (2NF)?” The seeded MCQ's correct answer is A; choosing C is a deliberate test answer that diagnoses confusion with 3NF.
- **Recovery question expected:** “What specific type of dependency does second normal form (2NF) remove?” Answer: “Partial dependencies.”
- **Evidence expected:** first question cites the `dbms-normalization#second-normal-form` passage about 1NF and partial dependencies; recovery cites “Partial dependencies are the problem this form removes.” The source is the built-in note, not the uploaded Computer Graphics document.
- **Engine:** this document-selected session uses the deterministic policy path. The provider panel currently reports a configured Gemini-compatible provider, but that does not mean this demo request uses Gemini. Narrate only the displayed **Deterministic Engine** status.
- **MCP:** the current local `/api/status` handshake succeeded and listed all five tools; `/healthz` returned `status: ok`. Tests cover quiz generation, verified evidence, answer evaluation, `record_progress`, mastery refresh and weak review. The proposed exact UI sequence has not been manually performed.

## Isolated recording setup

The default local database contains many repeated uploaded documents and prior history. Do not run `db:demo-seed` against that database. From the repository root, initialize a dedicated demo DB:

```powershell
$demoDb = Join-Path (Get-Location) 'data/local/studyflow-demo.db'
$env:DATABASE_PATH = $demoDb
npm run db:init
npm run db:demo-seed
```

`db:demo-seed` replaces only `local-student` progress in the path it is given and creates a timestamped backup first. Here that path is the dedicated demo DB. Keep the same `$demoDb` value in each service terminal:

**MCP terminal** (use a free port; 3002 avoids the currently running default MCP server):

```powershell
$env:DATABASE_PATH = (Join-Path (Get-Location) 'data/local/studyflow-demo.db')
$env:MCP_PORT = '3002'
npm run dev:mcp
```

**Web terminal** (use a free port; 3003 avoids the currently running default web app):

```powershell
$env:DATABASE_PATH = (Join-Path (Get-Location) 'data/local/studyflow-demo.db')
$env:MCP_SERVER_URL = 'http://127.0.0.1:3002/mcp'
npm run dev:web -- -p 3003
```

Open `http://localhost:3003`. If either port is taken, choose free ports and update both the command and MCP URL. Confirm `/api/status` says `reachable: true`, and `http://127.0.0.1:3002/healthz` says `status: "ok"` with five implemented tool names before recording.

## Timed screen plan

| Time | What the viewer sees and exact action | Exact narration | Expected app behavior / feature | Verification and edit guidance |
|---|---|---|---|---|
| **0:00–0:16** | Open the app welcome/setup screen. Keep the browser on the isolated demo instance. No uploads. | “StudyFlow turns a student’s own study notes and answer history into a focused tutoring session. I’ll show how it revisits a documented weak concept and checks the answer against its source.” | Intro to the product and grounded-adaptive value. | Product framing matches README. No claim of live Gemini or Alexa+ connectivity. |
| **0:16–0:38** | In Choose Study Material, select the built-in **dbms-normalization** sample. Select **Revise my weak concepts**. In Focus Topic type **2NF**. Click **Start Learning**. | “I’ve selected the built-in database-normalization notes and the weak-concept goal. The isolated demo history contains a recorded 2NF misconception, so this session has a specific reason to revisit it.” | Request is scoped to the chosen sample and 2NF. Header should show the deterministic response engine. | DB seed and routing inspected; exact UI sequence not browser-verified. Show only if the material badge and goal match. Hide the loading wait only by a clean edit; keep the request and resulting question visible. |
| **0:38–1:00** | Hold on the generated question and choices. Confirm it asks about Second Normal Form (2NF), not another topic. Do not reveal evidence before answering. | “The question asks what makes a table second normal form. I’m going to choose C on purpose; that option reflects a common mix-up with third normal form.” | Expected MCQ: “When is a table considered to be in second normal form (2NF)?” Option C says non-key attributes are independent. Correct option A describes 1NF plus no non-key attribute depending on only part of a composite candidate key. | Question and distractors come from seeded fixture; recovery sequence is supported by code/tests but still needs the manual check below. If the question differs, stop and retry from the demo DB seed. |
| **1:00–1:24** | Click option **C**, then **Submit answer**. Keep the screen recording through the actual result. | “That answer is incorrect. The tutor identifies the 2NF-versus-3NF confusion, then asks a targeted follow-up about partial dependencies.” | Expected diagnosis: `confuses-2nf-with-3nf`; real progress attempt is recorded; a targeted recovery question is generated. | Do not narrate the diagnosis until it appears. Keep the real submit and result in frame. Remove only idle loading frames in editing, never the action or result. |
| **1:24–1:51** | Show the follow-up question and its choices or answer field. Type **Partial dependencies** and submit. | “The follow-up checks the distinction directly. In 2NF, the problem removed is a partial dependency.” | Expected follow-up: “What specific type of dependency does second normal form (2NF) remove?” Expected evaluation: correct, with source evidence verified against `dbms-normalization#second-normal-form`. | Test suite verifies the supporting remediation/evaluation path, but the exact browser chain is not yet manually confirmed. Do not claim the misconception is resolved unless the returned UI state says so. |
| **1:51–2:17** | Hold on the returned evaluation and evidence card. Open the MCP trace panel. Show actual successful entries for `evaluate_answer`, `record_progress`, `get_mastery`, and the follow-up `generate_quiz`. Briefly show the mastery panel’s returned state. | “The feedback is tied to a verified sentence in the selected notes. The trace shows the actual tools used to evaluate the answer and save the attempt; the mastery panel reflects the returned study state.” | Real evidence citation, evaluation, persisted attempt and tool trace. No invented score or latency. | The current app status handshake and tool list were checked live; app tool execution is covered by integration tests. Confirm every displayed trace says success and belongs to this run. Do not imply a state change beyond the visible result. |
| **2:17–2:45** | Return to the learner view with the source and progress visible. End on the actual app, not a fabricated architecture slide. | “StudyFlow connects a local web tutor to a self-hosted MCP server over Streamable HTTP. The server exposes study-note search, quiz generation, answer evaluation, mastery lookup and progress recording. This is an Alexa+-inspired local simulation, not a direct Alexa+ integration.” | Accurate architecture and bounded close. | Keep only tool names actually shown on screen. Total target is 2:45; do not speed narration to hide a stuck or incorrect response. |

## Latency and recording rules

- Start the isolated MCP service first, then the web service. Open `/healthz` and `/api/status`, then load the app once to warm the local routes before recording. Do not grade or seed the personal default database as a warm-up.
- No response-time measurements were taken for this candidate path. Record the real loading state; in editing, trim only redundant waiting while leaving enough footage to understand the action and result.
- If a request stalls, repeats, returns a generic question, shows evidence from another source, or shows an engine inconsistent with the status badge, stop the take and investigate. Do not narrate over a failure or make a false success edit.
- The sample DBMS path is deterministic; don't call it a Gemini response. No voice input or speech output is needed for this recording.
- Keep at least a few seconds of readable result/evidence footage in each scene. Final duration, including title, transitions and end card, must be below 3:00.

## Known limitations to disclose

- The current persisted library has repeated uploads and poor extracted topics in some documents. This script deliberately uses the built-in sample in an isolated database.
- `GET /api/status` reported the Gemini-compatible provider as configured, while the selected document-session route is deterministic. Provider configuration is not proof of a live model call.
- The local app and MCP handshake are reachable now, but a fresh isolated demo instance and the proposed full browser interaction have not been run manually.
- The five MCP tools are implemented in this repository and the status endpoint lists them. The demo should show only tool calls actually present in the current trace.
- This project is a local, self-hosted MCP-backed web simulation. Direct Alexa+ integration, browser voice behavior and live Gemini output are not established by this demo path.
