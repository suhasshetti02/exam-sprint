import { IncidentSession } from "../src/engine";
import { scoreFromSessionSnapshot, scoreInvestigation } from "../src/rubric";
import { CHECKOUT_LATENCY_SCENARIO } from "../src/scenario";
import type { ScoreReport } from "../src/types";
import {
  PAIRED_TRIALS,
  SHARED_INSTRUCTIONS,
  TRIAL_PROMPTS,
  initialIncidentBriefing,
  type PairedTrialName,
  type TrialName,
} from "./briefing";
import {
  type ChatMessage,
  type LlmConfig,
  chatCompletion,
  extractJson,
} from "./llm";
import { startMcpEvalSession, type McpEvalHandle } from "./mcp-session";

export { PAIRED_TRIALS, type PairedTrialName };

export interface ConditionRecord {
  condition: "incident_bridge_mcp" | "llm_roleplay_baseline";
  trial: TrialName;
  model: string;
  inputs: { briefing: string; instructions: string; trialPrompt: string };
  messages: ChatMessage[];
  toolCalls: {
    name: string;
    arguments: unknown;
    result: unknown;
    via: "mcp-client";
    source: "model" | "evaluator";
  }[];
  rawOutputs: string[];
  parsedFinal: Record<string, unknown> | null;
  score: ScoreReport | null;
  notes: string[];
  mcp?: { url: string; transport: "streamable-http"; listedTools: string[] };
}

/** IDs that actually appeared in the role-play conversation. Pager briefing mints none. */
export function idsVisibleInText(text: string, candidates: string[]): string[] {
  return candidates.filter((id) => text.includes(id));
}

export function scoreRolePlayBaseline(parsed: {
  diagnosisId?: string;
  recoveryActionId?: string;
  citedEvidenceIds?: string[];
  conversationText?: string;
}): ScoreReport {
  const diagnosisId = parsed.diagnosisId ?? null;
  const recoveryActionId = parsed.recoveryActionId ?? null;
  const cited = parsed.citedEvidenceIds ?? [];
  const observedEvidenceIds = idsVisibleInText(parsed.conversationText ?? "", cited);
  const unsafe = CHECKOUT_LATENCY_SCENARIO.actions.some(
    (action) => action.id === recoveryActionId && action.safety === "unsafe",
  );
  return scoreInvestigation({
    scenario: CHECKOUT_LATENCY_SCENARIO,
    diagnosisId,
    recoveryActionId,
    citedEvidenceIds: cited,
    observedEvidenceIds,
    usedTools: [],
    unsafeRecoveryAttempted: unsafe,
  });
}

function parseMcpPayload(result: unknown): {
  state?: {
    phase: "incident" | "degraded" | "recovered";
    observedEvidenceIds: string[];
    usedTools: string[];
    diagnosisId: string | null;
    recoveryActionId: string | null;
    citedEvidenceIds?: string[];
    unsafeRecoveryAttempted: boolean;
  };
} | null {
  const payload = result as {
    structuredContent?: { state?: Record<string, unknown> };
    content?: { text?: string }[];
  };
  if (payload.structuredContent?.state) {
    return payload.structuredContent as { state: NonNullable<ReturnType<typeof parseMcpPayload>>["state"] };
  }
  const text = payload.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as { state?: NonNullable<ReturnType<typeof parseMcpPayload>>["state"] };
  } catch {
    return null;
  }
}

function scoreMcpTrial(result: unknown, parsedFinal: Record<string, unknown> | null): ScoreReport | null {
  const parsed = parseMcpPayload(result);
  const state = parsed?.state;
  if (!state) return null;
  return scoreFromSessionSnapshot(
    CHECKOUT_LATENCY_SCENARIO,
    {
      phase: state.phase,
      observedEvidenceIds: state.observedEvidenceIds ?? [],
      usedTools: state.usedTools ?? [],
      diagnosisId: state.diagnosisId ?? null,
      recoveryActionId: state.recoveryActionId ?? null,
      citedEvidenceIds: state.citedEvidenceIds ?? [],
      unsafeRecoveryAttempted: Boolean(state.unsafeRecoveryAttempted),
    },
    {
      diagnosisId: typeof parsedFinal?.diagnosisId === "string" ? parsedFinal.diagnosisId : undefined,
      recoveryActionId: typeof parsedFinal?.recoveryActionId === "string" ? parsedFinal.recoveryActionId : undefined,
      citedEvidenceIds: Array.isArray(parsedFinal?.citedEvidenceIds)
        ? parsedFinal.citedEvidenceIds.filter((id): id is string => typeof id === "string")
        : undefined,
    },
  );
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function runIncidentBridgeMcpTrial(
  config: LlmConfig,
  trial: TrialName,
): Promise<ConditionRecord> {
  const sessionId = `llm-ib-${trial}`;
  const mcp: McpEvalHandle = await startMcpEvalSession(sessionId);
  const briefing = initialIncidentBriefing();
  const listedTools = await mcp.listToolNames();
  const tools = await mcp.openaiTools();
  const instructions = [
    SHARED_INSTRUCTIONS,
    "Condition: IncidentBridge. Tools are real MCP tools on a local Streamable HTTP server.",
    "Call tools via the provided function interface. Do not invent JSON tool-call documents in prose.",
    `sessionId is always "${sessionId}". Include it in every tool call.`,
    `Available MCP tools: ${listedTools.join(", ")}.`,
    "Investigate with query_metrics, search_logs, inspect_deployments, and get_runbook before concluding.",
    "Finish by calling submit_diagnosis and apply_recovery_action.",
  ].join(" ");
  const trialPrompt = TRIAL_PROMPTS[trial];
  const messages: ChatMessage[] = [
    { role: "system", content: instructions },
    { role: "user", content: `${briefing}\n\nTask: ${trialPrompt}` },
  ];
  const toolCalls: ConditionRecord["toolCalls"] = [];
  const rawOutputs: string[] = [];
  const notes: string[] = [];
  let parsedFinal: Record<string, unknown> | null = null;

  try {
    for (let step = 0; step < 12; step += 1) {
      const result = await chatCompletion(config, messages, { tools });
      rawOutputs.push(JSON.stringify(result.raw));
      if (result.toolCalls.length) {
        messages.push({
          role: "assistant",
          content: result.content || null,
          tool_calls: result.toolCalls,
        });
        for (const call of result.toolCalls) {
          const args = parseArgs(call.arguments);
          const mcpResult = await mcp.callTool(call.name, args);
          toolCalls.push({
            name: call.name,
            arguments: { sessionId, ...args },
            result: mcpResult,
            via: "mcp-client",
            source: "model",
          });
          const blocks = (mcpResult as { content?: { text?: string }[] }).content;
          const text = blocks?.[0]?.text ?? JSON.stringify(mcpResult);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: call.name,
            content: text,
          });
        }
        continue;
      }

      messages.push({ role: "assistant", content: result.content });
      try {
        parsedFinal = extractJson(result.content) as Record<string, unknown>;
      } catch (error) {
        notes.push(`final_parse_error step ${step}: ${error instanceof Error ? error.message : "parse"}`);
      }
      break;
    }

    const modelMadeToolCalls = toolCalls.some((call) => call.source === "model");
    const transcript = await mcp.callTool("get_transcript", {});
    toolCalls.push({
      name: "get_transcript",
      arguments: { sessionId },
      result: transcript,
      via: "mcp-client",
      source: "evaluator",
    });
    if (!modelMadeToolCalls) {
      notes.push("mcp_client_used_but_model_made_no_tool_calls");
    }
    return {
      condition: "incident_bridge_mcp",
      trial,
      model: config.model,
      inputs: { briefing, instructions, trialPrompt },
      messages,
      toolCalls,
      rawOutputs,
      parsedFinal,
      score: scoreMcpTrial(transcript, parsedFinal),
      notes,
      mcp: { url: mcp.url, transport: "streamable-http", listedTools },
    };
  } finally {
    await mcp.close();
  }
}

export async function runBaselineLlmTrial(config: LlmConfig, trial: TrialName): Promise<ConditionRecord> {
  const briefing = initialIncidentBriefing();
  const instructions = [
    SHARED_INSTRUCTIONS,
    "Condition: plain incident role-play. You have NO tools, NO live metrics, NO log search, and NO runbook retrieval.",
    "You will not receive additional telemetry after this message.",
    'Reply with one JSON object: {"diagnosisId":"...","rationale":"...","citedEvidenceIds":["..."],"recoveryActionId":"...","decision":"..."}',
    "citedEvidenceIds may only contain IDs that appeared in this conversation. The pager briefing does not mint METRIC_*, LOG_*, or DEPLOY_* IDs.",
  ].join(" ");
  const trialPrompt = TRIAL_PROMPTS[trial];
  const messages: ChatMessage[] = [
    { role: "system", content: instructions },
    { role: "user", content: `${briefing}\n\nTask: ${trialPrompt}` },
  ];
  const result = await chatCompletion(config, messages);
  const rawOutputs = [JSON.stringify(result.raw)];
  messages.push({ role: "assistant", content: result.content });
  const notes: string[] = [];
  let parsedFinal: Record<string, unknown> | null = null;
  try {
    parsedFinal = extractJson(result.content) as Record<string, unknown>;
  } catch (error) {
    notes.push(error instanceof Error ? error.message : "parse");
  }
  const conversationText = messages.map((m) => m.content ?? "").join("\n");
  const score = parsedFinal
    ? scoreRolePlayBaseline({
        diagnosisId: typeof parsedFinal.diagnosisId === "string" ? parsedFinal.diagnosisId : undefined,
        recoveryActionId: typeof parsedFinal.recoveryActionId === "string" ? parsedFinal.recoveryActionId : undefined,
        citedEvidenceIds: Array.isArray(parsedFinal.citedEvidenceIds)
          ? parsedFinal.citedEvidenceIds.filter((id): id is string => typeof id === "string")
          : [],
        conversationText,
      })
    : null;
  return {
    condition: "llm_roleplay_baseline",
    trial,
    model: config.model,
    inputs: { briefing, instructions, trialPrompt },
    messages,
    toolCalls: [],
    rawOutputs,
    parsedFinal,
    score,
    notes,
  };
}

export async function runPairedTrial(
  config: LlmConfig,
  trial: PairedTrialName,
): Promise<{ trial: PairedTrialName; incidentBridge: ConditionRecord; baseline: ConditionRecord }> {
  const incidentBridge = await runIncidentBridgeMcpTrial(config, trial);
  const baseline = await runBaselineLlmTrial(config, trial);
  return { trial, incidentBridge, baseline };
}

export function emptySessionForTests(): IncidentSession {
  return new IncidentSession();
}
