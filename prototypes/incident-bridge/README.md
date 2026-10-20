# IncidentBridge proof of concept

Isolated hackathon prototype. It does **not** modify Exam Sprint / StudyFlow.

Scenario: checkout latency rises after `checkout-api` v2.14.0 reduced the connection-pool timeout. A CDN origin-5xx alert is a symptom, not the cause.

## Run (from this directory)

```powershell
npm install
npm test
npm run demo
npm run eval
```

`npm run eval` writes `eval/results/last-run.json`. The tool-enabled condition starts a local Streamable HTTP MCP server and calls tools through the MCP client SDK. The role-play condition has no tools. Both are scored with `src/rubric.ts`. Live LLM comparison runs only when an API key is present (`INCIDENT_BRIDGE_LLM_API_KEY`, `LLM_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`). HTTP 429/503 are infrastructure, not model failures.

See `EVALUATION.md` for the checkout-latency comparison table.

Optional MCP server (port 3101, does not collide with Exam Sprint on 3001):

```powershell
npm run start:mcp
```

## Out of scope for this PoC

Authentication, cloud deploy, a real UI, production telemetry integrations, and Alexa.
