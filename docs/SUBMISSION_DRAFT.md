# StudyFlow — submission copy draft

**Status:** Prepared for manual review and copy/paste. Nothing in this file has been submitted to Devpost.

**Deadline:** Friday, October 23, 2026 at 12:00 PM Pacific Time (Saturday, October 24, 2026 at 12:30 AM India Standard Time), per the official hackathon page. Verify the live Devpost countdown/form before the final submission.

## Suggested title

StudyFlow — Adaptive, Evidence-Grounded Study Tutor

## Short description

StudyFlow turns a learner’s own notes and answer history into a focused study session. It explains concepts from retrieved source material, asks grounded questions, evaluates answers, tracks misconceptions and mastery in SQLite, and selects concepts for later review. A self-hosted MCP server exposes five study tools to an Alexa+-inspired local web simulation.

## Problem

Generic quiz generators usually repeat questions without knowing whether a learner understands the material or where their mistakes come from. Students also need to verify why an explanation is trustworthy and return to the exact source they studied.

## What StudyFlow does

The learner chooses a document and a study goal: Teach me this material, Quiz me on a topic, Revise my weak concepts, or Help me study the full document. StudyFlow retrieves content from that document, presents source evidence, evaluates the learner’s answer, stores progress locally, and uses persisted attempts and unresolved misconceptions to guide review. A separate Rapid-Fire mode provides timed practice.

The MCP server exposes `search_study_notes`, `get_mastery`, `generate_quiz`, `evaluate_answer` and `record_progress` over Streamable HTTP. A bounded server-side agent may use the optional configured Gemini-compatible provider; deterministic fallback keeps the local tutor usable without an API key. The response status must be described according to the engine actually used.

## Track and integration

**Primary track:** Alexa+ (participant must confirm this selection on Devpost).

**Integration:** Self-hosted MCP server using the Model Context Protocol TypeScript SDK and Streamable HTTP. The web UI is a local Alexa+-inspired simulation client. This project does not claim a direct Alexa+ platform integration.

**Mini-challenge:** Leave unselected unless the participant independently verifies eligibility and supplies the required evidence. The inspected repository does not show AWS Builder services. For Open Source, confirm that a qualifying public-repository contribution was made during the hackathon and provide its exact contribution URL before selecting it.

## What changed during the hackathon

Review the published baseline against the actual commits before using this section. At audit time, local `feat/tutor-experience` is at `93a2e83`, three commits ahead of `origin/main` (`1e77f2c`); no changes were pushed. The local branch contains assessment-integrity and idempotency work, document-scoped learning flows, voice interaction/state handling, verified evidence display, and test coverage for the four learning goals. The public GitHub `main` page still showed two commits. Describe only changes that are in the final repository URL submitted to Devpost, and provide a concise before/after account supported by commit history and the demo.

## Technology

Next.js, React, TypeScript, Tailwind CSS, Express, the Model Context Protocol TypeScript SDK, Zod, Node.js built-in SQLite, Vitest and ESLint. An optional Gemini-compatible API adapter is included; live provider use is not assumed.

## Repository and demo links

- **GitHub repository:** https://github.com/suhasshetti02/exam-sprint
- **Demo video:** Add the public YouTube or Vimeo URL after upload and signed-out accessibility check. The video must be under three minutes and show the project functioning.
- **Testing instructions:** See the repository README; confirm that its run instructions and license are complete in the exact GitHub revision submitted.

## Limitations to disclose

- This is a local Alexa+-inspired simulation and self-hosted MCP implementation, not a live Alexa+ integration.
- Voice uses browser Web Speech APIs and requires manual verification in the recording browser.
- Live Gemini behavior is unverified unless the participant completes a live smoke test.
- Local development uses single-learner SQLite state; multi-user authentication/tenant isolation is not implemented.
- The tracked MIT license still has copyright/year placeholders and needs owner review before claiming it as a complete open-source license.

## Manual Devpost checklist

- [ ] Confirm primary track selection and any mini-challenge selection.
- [ ] Review and finalize the disclosure of hackathon-period changes.
- [ ] Publish the final code to GitHub after reviewing changes; do not submit a stale branch that lacks the demonstrated code.
- [ ] Resolve the license placeholders if submitting the public-repository route.
- [ ] Upload a public English demo video under three minutes and verify it signed out.
- [ ] Paste final product feedback for every tool/API/SDK actually used.
- [ ] Submit genuine friction-log entries only when substantiated; none were added by this audit.
- [ ] Complete the actual Devpost form before the published deadline.
