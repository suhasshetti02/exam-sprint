# Product feedback draft — Amazon Developer Hackathon 2026

**Status:** Editable draft for the participant to review and paste into the official Devpost form. This file is not a submitted feedback form. Comments below are limited to repository inspection, local automated checks, and the public hackathon documentation read during this audit; live-provider and physical voice behavior were not tested here.

## Primary track

Alexa+. StudyFlow uses a self-hosted MCP server over Streamable HTTP and a local web-based Alexa+-inspired simulation. It does not use Alexa+ partner-only tooling or connect directly to the Alexa+ service.

## Tools, APIs and SDKs in the project

### MCP TypeScript SDK and Streamable HTTP

- **Use:** `@modelcontextprotocol/sdk` 1.32.1 creates the MCP server/client and carries `tools/list` and `tools/call` over Streamable HTTP. Express exposes `/mcp` and `/healthz`.
- **Observed working:** Source registers five study tools; automated server tests exercise HTTP initialization, discovery, validation and tool calls, including an initialize request for protocol version `2025-11-25`.
- **Needs work / limitation:** Local protocol tests do not establish compatibility with a hosted Alexa+ runtime. This project has not been connected to Alexa+ itself. The current repository’s historical QA notes contain older, conflicting version claims; use current tests/source as the evidence and keep release notes synchronized.
- **Onboarding:** This audit used the published MCP specification and Devpost rules/FAQ. Devpost FAQ says partner-only Alexa+ add-on tools are not required for the self-hosted MCP or web-simulation route.
- **Use again?** Yes for a portable, tool-oriented local integration; confirm personally before submitting this opinion.

### Amazon Developer Hackathon Alexa+ track and Devpost guidance

- **Use:** The project is being prepared for the Alexa+ track. Current official rules permit a self-hosted MCP server using MCP 2025-11-25 or later over Streamable HTTP, or an alternative web simulation.
- **Observed working:** The public rules and FAQ clarify the allowed integration paths, repository access choices, video requirements and requested feedback fields.
- **Needs work:** The FAQ notes that Alexa+ add-on developer tools are partner preview only. Clear, prominent guidance distinguishing an accepted web simulation from a direct Alexa+ integration helps avoid false assumptions.
- **Onboarding:** The hackathon’s FAQ clarified the simulator/tool access question; participant should add their own experience with any official office hours or other Amazon tools used.
- **Use again?** Participant to confirm.

### Google Gemini API-compatible provider (optional)

- **Use:** The web server has a provider adapter configurable for Gemini’s OpenAI-compatible endpoint. A deterministic tutor is available when no live provider is configured or when the live path falls back.
- **Observed working:** The code and mocked tests cover provider selection/fallback behavior. No live API request was made during this audit.
- **Needs work:** Do not submit an opinion about live reliability, latency, cost or onboarding until the participant has personally tested the configured provider. Provider status must report the engine used for the current response.
- **Onboarding:** Live setup requires a user-supplied key; this draft contains no key and does not claim a live smoke test.
- **Use again?** Participant to confirm after live testing.

### Node.js, TypeScript, npm workspaces and built-in SQLite

- **Use:** Node.js runs the web/MCP services and `node:sqlite`; TypeScript and npm workspaces organize the app/core/server packages.
- **Observed working:** Node 24.14.0 and npm 11.9.0 were present. The root tests emitted Node’s experimental SQLite warning. The repository requires Node >=22.12. The current `node_modules` initially lacked the local `@exam-sprint/core` workspace link, and typecheck failed. An install attempt did not finish; the offline retry reported an uncached `brace-expansion` tarball and a Windows cleanup `EPERM`. The workspace link appeared during that attempt, and typecheck passed afterward. A clean install has not been verified.
- **Needs work:** Onboarding should make it clear that workspace dependencies must be installed from the monorepo root. `node:sqlite` warning/experimental status should be documented for the supported Node version.
- **Onboarding:** `npm install` is the documented installation step. This host's incomplete existing install/cache complicated setup; participant should confirm a clean-machine install independently.
- **Use again?** Yes for a lightweight local prototype, subject to confirming the SQLite/runtime support expectations.

### Next.js, React and Tailwind CSS

- **Use:** Next.js App Router and React provide the tutoring UI and server-side API routes; Tailwind CSS styles the interface.
- **Observed working:** Source contains the setup flow, tutoring session, question/evidence/mastery panels and local API routes. Automated UI and integration tests exist. This audit did not manually verify browser layout or interaction.
- **Needs work:** Note any specific framework issue only after reproducing it. Browser-specific voice and layout behavior still need manual checks.
- **Onboarding:** Participant to describe their own experience building the app.
- **Use again?** Participant to confirm.

### Express, Zod and `pdf-parse`

- **Use:** Express hosts the MCP endpoint; Zod validates shared tool/API contracts; `pdf-parse` supports study-document ingestion.
- **Observed working:** They are present in package manifests and the server validates tool calls. The tests cover text/PDF ingestion paths; no new PDF was manually uploaded during this audit.
- **Needs work:** Participant to add only reproduced compatibility or documentation issues.
- **Onboarding:** Participant to confirm from their development experience.
- **Use again?** Participant to confirm.

### Vitest and ESLint

- **Use:** Vitest runs unit/integration tests; ESLint checks the repository.
- **Observed working:** `npm test` completed with 371 passing and 1 optional live-provider test skipped on the final rerun. Typecheck, lint and production build passed. Earlier full-suite reruns had one intermittent PDF timeout and one intermittent quiz-choice assertion; the focused tests and final full rerun passed.
- **Needs work:** A clean dependency install remains unverified on this Windows host; the attempted install hit a missing cached package and cleanup warning. Confirm a clean registry-backed setup before describing installation as validated.
- **Onboarding:** The package scripts provide repository-level commands; participant to confirm.
- **Use again?** Yes for deterministic local regression coverage, subject to final full-run results.

## Not used in this project

The inspected manifests and runtime code do not show use of Amazon Bedrock, AgentCore, Strands SDK, Alexa+ partner SDK/CLI, or a live Alexa+ platform connection. Do not select the AWS Builder mini-challenge based on research or this Alexa+ track alone.

## Before submission

- Confirm which optional providers/services you personally used and whether you want to recommend them.
- Update the incomplete observations after successful clean install, full test/lint/build checks, and any live-provider/browser tests you perform.
- Paste the final feedback into the actual Devpost submission form; this draft does not submit it.
