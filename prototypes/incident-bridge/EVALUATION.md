# IncidentBridge evaluation (hackathon PoC)

Isolated to `prototypes/incident-bridge`. StudyFlow was not modified.

**Git:** this project tree has no `.git` of its own and is untracked in the enclosing repository. The enclosing repository was at `02f130cbfccd1718c2a581be3c1fd3117c4cc145` when this report was generated; that hash identifies the enclosing repository HEAD, not the untracked IncidentBridge files.

## Result classes (do not mix)

| Class | What it is | This run |
| --- | --- | --- |
| Deterministic unit tests | Engine properties: consistency, invalid actions, unsafe recovery, scoring | **36/36 passed** (`npm test`, 8 test files) |
| Deterministic scripted IncidentBridge | Fixed trainee traces against checkout + held-out scenarios | Repeatable scores below |
| Deterministic pager-only stand-ins | Same briefing, no tools. **Not an LLM.** | Repeatable scores below |
| Type check | TypeScript `tsc --noEmit` | **Passed** (`npm run typecheck`) |
| Live LLM (same model both conditions) | `gemini-3.8-flash` via OpenAI-compatible Gemini endpoint | **No completed trials.** All six requests returned HTTP 429 quota errors. Infrastructure failure, not a model failure. |

Shared briefing for both conditions: checkout p99 elevated, CDN origin-5xx at POP iad-12, a deployment window this afternoon, diagnosis/action ID lists. The briefing does **not** include log lines, deploy diffs, runbook body, or `METRIC_*` / `LOG_*` / `DEPLOY_*` IDs.

## MCP tools

`query_metrics`, `search_logs`, `inspect_deployments`, `get_runbook`, `record_decision`, `apply_recovery_action`, `submit_diagnosis`, `get_transcript`.

Example (stable until a recovery action mutates phase): `query_metrics(checkout.p99_latency_ms)` ends at **2410**; after `rollback_checkout_api` the latest point is **188**; after `purge_cdn` it is **2680**.

The evaluation tool condition uses `@modelcontextprotocol/sdk`'s MCP `Client` with a `StreamableHTTPClientTransport` connected to the local `/mcp` server. It lists tools from that server and executes model-requested calls using `client.callTool`; it does not simulate tool use by passing JSON descriptions through chat. The `mcp-client.test.ts` and paired protocol test exercise that client/server path. `eval/results/last-run.json` records complete successful-trial inputs, chat messages, raw model response payloads, every MCP call's arguments and full result, and the evaluator's final `get_transcript` call. Tool calls distinguish `source: "model"` from `source: "evaluator"`.

The paired live protocol runs the same model sequentially in both conditions, with the same initial briefing and per-trial prompt. It includes correct investigation, misleading evidence, and unsafe recovery. The plain role-play has no tools; both conditions are scored by the same external deterministic `scoreInvestigation` rubric.

## Deterministic IncidentBridge trials

| Trial | Diagnosis | Recovery | Evidence-backed diagnosis | Evidence-backed recovery | Unsafe | Score |
| --- | --- | --- | --- | --- | --- | --- |
| Correct investigation | `checkout_pool_timeout_regression` | `rollback_checkout_api` | yes | yes | no | **100** |
| Unsafe recovery | none | `purge_cdn` | no | no | yes (phase `degraded`) | **0** |
| Unsupported diagnosis | `cdn_cache_miss_storm` | none | no | no | no | **10** |
| Misleading citations | `cdn_cache_miss_storm` citing `METRIC_CDN_RED_HERRING`, `LOG_CDN_ALERT`, `DEPLOY_CDN_TTL` | none | no | no | no | **20** |
| Held-out search latency (property check) | scenario ground truth | scenario rollback | yes | yes | no | **100** |

Misleading-citation detail: those three IDs **were returned by tools** and **do not support** `cdn_cache_miss_storm` (`citedEvidenceSupportsClaim=false`, `returnedButNonSupportingCitedIds` lists all three). Checkout ground truth was not changed to produce this result.

Held-out scenario uses different services and IDs. Tests assert engine properties against `SEARCH_LATENCY_SCENARIO.groundTruth`, not a hardcoded checkout transcript.

## Deterministic pager-only stand-ins (same briefing, no tools)

These exist so the comparison is runnable without a live model. They are **not** measured LLM results.

| Policy | Trial | Score | Notes |
| --- | --- | --- | --- |
| Alert follower | correct | 0 | CDN diagnosis + `purge_cdn` (unsafe) |
| Alert follower | unsafe | 0 | Instructed purge |
| Alert follower | unsupported | 10 | Wrong diagnosis, no unsafe action |
| Alert follower | misleading | 0 | Cites CDN IDs that never appeared in the briefing (`citedButNotReturnedIds`) |
| Title heuristic | correct | 50 | Guesses the true diagnosis/rollback **without** observed evidence → diagnosis not supported, recovery unsupported; matching action retains partial numeric credit. **Explicit outcome: failed investigation (`luckyRecoveryGuess=true`).** |
| Title heuristic | unsafe | 0 | Still purges |
| Title heuristic | unsupported | 10 | |
| Title heuristic | misleading | 0 | Cites checkout evidence IDs that were never returned |

Title-heuristic correct shows the product claim without stacking the deck: a no-tools agent can **name** the right rollback from the incident title and still fail the evidence gate (`diagnosisSupportedByEvidence=false`). Numeric score and investigation outcome are separate: a coincidentally correct recovery action does **not** convert an unsupported diagnosis into a passing investigation.

## Live LLM vs IncidentBridge (measured)

Attempted on **2026-10-18 19:34 IST** with the **same** model for both conditions: `gemini-3.8-flash`. Three paired cases (`correct`, `misleading`, `unsafe`) were scheduled, for six condition/trial requests total.

| Condition | Trials completed | Recorded outcome |
| --- | --- | --- |
| IncidentBridge + actual MCP tools | 0 | All three requests returned HTTP 429 (Gemini free-tier quota exceeded) |
| Plain role-play baseline (no tools) | 0 | All three requests returned HTTP 429 (Gemini free-tier quota exceeded) |

**No diagnosis, recovery, transcript, tool call, or score from the live model is available.** This run does **not** show that either condition investigated incorrectly, chose an unsafe action, or invented evidence. The API returned infrastructure quota errors before any model completion; these are not model failures. The evaluation runner classifies HTTP errors separately and does not score them as failed investigations.

The generated artifact is `eval/results/last-run.json` (gitignored). It records the model, shared briefing, paired protocol, all six infrastructure errors, and the deterministic scripted results. Since no LLM request completed, there are no live input/output traces or live MCP tool calls to archive for this run.

## Properties verified (unit + scripted)

- Repeated metric queries are identical until a defined recovery action changes phase.
- Invalid actions are rejected without changing phase.
- Unsafe purge degrades checkout latency; replica scale is safe but ineffective.
- Diagnosis is unsupported without required observations, even if the ID is ground truth.
- Returned-but-non-supporting citations are flagged independently of the numeric score.
- Scores reproduce across two independent scripted runs.
- The lucky-recovery title heuristic retains its 50-point partial score but is explicitly classified as a failed investigation.
- MCP tool listing and calls traverse a real local Streamable HTTP MCP client/server interaction.

## Limitations

- One frozen checkout scenario plus one held-out sibling; not a scenario library.
- Live same-model comparison is incomplete because the API quota prevented all model completions.
- Baseline recovery points for matching `rollback_checkout_api` do not prove causal recovery.
- The evaluation protocol's MCP client/server path is tested, but no live model-generated MCP call completed in this run.
- No UI, auth, production telemetry, or multi-user sessions.

## Remaining work before a real product

- Complete a live same-model eval (IncidentBridge MCP tools vs role-play) when API quota is available, then archive the resulting full traces.
- Thin trainee console only after that, or as a viewer over the existing deterministic session.
- Authoring format for more scenarios without encoding expected transcripts in tests.

## Recommendation

**NO-GO for a full interface build.** The engine, evidence gate, misleading-alert scenario, and reproducible paired runner are ready to keep evaluating, but this run has **no measured LLM baseline**. Building a UI now would freeze a training loop whose model-vs-tools value is still unmeasured.

**GO to keep iterating the isolated PoC** (more scenarios, a successful live eval, then a thin console if the live traces justify it).
