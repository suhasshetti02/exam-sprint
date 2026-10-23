# StudyFlow demo — recording checklist

## 1. Use a separate database

The current default database has many repeated uploaded documents and prior study history. Keep it untouched for the recording. In PowerShell, from the repository root:

```powershell
$demoDb = Join-Path (Get-Location) 'data/local/studyflow-demo.db'
$env:DATABASE_PATH = $demoDb
npm run db:init
npm run db:demo-seed
```

The seed script backs up the database file it targets, then replaces `local-student` progress in that database. Confirm `$demoDb` is the dedicated `studyflow-demo.db` path before running it. Re-seeding is safe for personal data only because the target is isolated.

## 2. Start the services

The repository requires Node.js 22.12 or newer and npm workspace dependencies. The current default web/MCP ports are already occupied in this checkout session, so use the alternate ports below or select free ports and keep the MCP URL in sync.

**Terminal 1 — MCP server:**

```powershell
$env:DATABASE_PATH = (Join-Path (Get-Location) 'data/local/studyflow-demo.db')
$env:MCP_PORT = '3002'
npm run dev:mcp
```

**Terminal 2 — web app:**

```powershell
$env:DATABASE_PATH = (Join-Path (Get-Location) 'data/local/studyflow-demo.db')
$env:MCP_SERVER_URL = 'http://127.0.0.1:3002/mcp'
npm run dev:web -- -p 3003
```

Open `http://localhost:3003`. If a port is in use, choose another and update `MCP_PORT`, `MCP_SERVER_URL` and the web `-p` value accordingly. Set the database environment variable in every service terminal; otherwise one service may read a different SQLite file.

## 3. Health checks before capture

- [ ] `http://127.0.0.1:3002/healthz` returns `status: "ok"`, server `exam-sprint`, and five implemented tools.
- [ ] `http://localhost:3003/api/status` returns `reachable: true` and lists the same tools. This endpoint performs the web-to-MCP handshake.
- [ ] `http://localhost:3003/api/documents` includes the built-in sample `dbms-normalization` with six chunks.
- [ ] The provider field may say Gemini is configured. That is configuration only. For the selected document session, expect the UI to report **Response: Deterministic Engine**.
- [ ] No API key is visible in a terminal, browser, screen recording or narration.

## 4. Set up the exact session

- [ ] Confirm **dbms-normalization** is selected and marked as the built-in sample. Do not choose the uploaded Computer Graphics document or a duplicate upload.
- [ ] Choose **Revise my weak concepts**.
- [ ] Enter **2NF** in Focus Topic.
- [ ] Click **Start Learning**.
- [ ] Wait for the question. It should read: **“When is a table considered to be in second normal form (2NF)?”**
- [ ] The choices should describe 2NF, BCNF, 3NF and one unrelated option; A is the correct answer. For the demonstrated remediation, deliberately choose **C** and submit. State that this is the demo’s test answer in the narration.
- [ ] The returned feedback should diagnose **confuses-2nf-with-3nf** and show a targeted question: **“What specific type of dependency does second normal form (2NF) remove?”**
- [ ] Type **Partial dependencies** and submit. Confirm the real evaluation result before narrating it.
- [ ] Confirm the revealed evidence is from `dbms-normalization#second-normal-form` and supports partial dependencies. Evidence must not refer to another document.
- [ ] Show the returned mastery/progress state as it appears. Do not promise a specific percentage or that a misconception cleared unless the UI explicitly reports it.

## 5. MCP trace to show

On this specific weak-topic request, expect the trace to include `get_mastery` and `generate_quiz`. On answer submission, show the actual successful `evaluate_answer`, `record_progress` and `get_mastery` calls; the diagnosed wrong answer should also trigger a recovery `generate_quiz` call. `search_study_notes` is registered, but this explicit 2NF weak-review route does not need to call it.

The five registered tools are:

- `search_study_notes`
- `get_mastery`
- `generate_quiz`
- `evaluate_answer`
- `record_progress`

Only name or narrate calls that are present in the current run’s trace. Keep statuses and durations real; do not create fake trace rows or timing overlays.

## 6. Invalid run — stop and retry

**Do not record or publish the take** if any of the following happens:

- MCP is unreachable, or the app shows `Could not reach the MCP server`.
- The session starts with `Invalid session request` or another API error.
- The selected material is not `dbms-normalization`, the question is not about 2NF, or evidence comes from another document.
- The tutor shows a generic placeholder instead of a complete question.
- The evidence is missing, unverified, or unrelated to the visible question.
- The response-engine badge says Live AI for this document-grounded deterministic flow, or otherwise contradicts the actual path.
- The interface repeats a response, gets stuck, or fails to show the returned evaluation or trace.
- The recovery step differs from the intended question. Stop the take; do not improvise an answer or edit in a false success.

## 7. Capture setup and final checks

- [ ] Use a clean browser profile, one app tab, and a full-window capture. A 1920×1080 capture should give the app and trace panel room; the three-column results view should remain readable. Check the actual layout before recording and adjust browser zoom/window only as needed.
- [ ] Close unrelated tabs, terminals, taskbar popovers and notifications. Hide terminal windows after checks; never expose secrets.
- [ ] Narration is planned as a separate voice-over, so no microphone permission is required for this path. If recording live narration, use a separate mic track, monitor levels, and keep the environment quiet. Do not imply browser voice input was tested.
- [ ] Load the app and health endpoints once before capture to warm the local services. This is not a measured performance claim.
- [ ] Record the real clicks, request, loading state, returned question, answer, feedback, evidence and MCP trace. Editing may trim redundant waiting, but retain enough continuous footage to understand each action/result pair.
- [ ] Do not add fabricated mastery values, Gemini output, Alexa+ integration, tool calls or timing.
- [ ] Check the final export duration, including title/transitions/end screen: **under 3:00**, target **2:45**.
- [ ] Listen to the exported audio against the screen, check that no narration claims an outcome before it appears, and verify the final video plays from start to finish.
- [ ] If a public video URL is later created, open it in a signed-out/private window and verify playback before submitting it. This project task does not upload or publish the video.
