import { z } from "zod";
import { IncidentSession } from "./engine";
import { KNOWN_METRICS } from "./scenario";

export const sessionStore = new Map<string, IncidentSession>();

export function getSession(sessionId = "default"): IncidentSession {
  const existing = sessionStore.get(sessionId);
  if (existing) return existing;
  const created = new IncidentSession();
  sessionStore.set(sessionId, created);
  return created;
}

export function resetSession(sessionId = "default"): IncidentSession {
  const created = new IncidentSession();
  sessionStore.set(sessionId, created);
  return created;
}

function jsonResult(data: unknown) {
  return {
    structuredContent: data,
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? `${"code" in error ? String((error as { code: string }).code) : "error"}: ${error.message}` : "internal: unexpected failure";
  return { isError: true as const, content: [{ type: "text" as const, text: message }] };
}

const sessionField = z.string().min(1).max(64).default("default");

export const mcpTools = [
  {
    name: "query_metrics",
    title: "Query metrics",
    description: "Return a deterministic timeseries for a named metric in the active incident session.",
    inputSchema: z.object({
      sessionId: sessionField,
      metric: z.string().min(1).describe(`One of: ${KNOWN_METRICS.join(", ")}`),
    }),
    handler: (input: { sessionId?: string; metric: string }) => {
      return getSession(input.sessionId).queryMetrics(input.metric);
    },
  },
  {
    name: "search_logs",
    title: "Search logs",
    description: "Search frozen incident logs by substring, optionally scoped to a service.",
    inputSchema: z.object({
      sessionId: sessionField,
      query: z.string().min(2).max(200),
      service: z.string().min(1).optional(),
    }),
    handler: (input: { sessionId?: string; query: string; service?: string }) => {
      return getSession(input.sessionId).searchLogs(input.query, input.service);
    },
  },
  {
    name: "inspect_deployments",
    title: "Inspect deployments",
    description: "List deployment history for the scenario, optionally filtered by service.",
    inputSchema: z.object({
      sessionId: sessionField,
      service: z.string().min(1).optional(),
    }),
    handler: (input: { sessionId?: string; service?: string }) => {
      return getSession(input.sessionId).inspectDeployments(input.service);
    },
  },
  {
    name: "get_runbook",
    title: "Get runbook guidance",
    description: "Retrieve the incident runbook, optionally filtered by topic.",
    inputSchema: z.object({
      sessionId: sessionField,
      topic: z.string().min(1).optional(),
    }),
    handler: (input: { sessionId?: string; topic?: string }) => {
      return getSession(input.sessionId).getRunbook(input.topic);
    },
  },
  {
    name: "record_decision",
    title: "Record a trainee decision",
    description: "Append a free-form investigative decision to the auditable transcript.",
    inputSchema: z.object({
      sessionId: sessionField,
      statement: z.string().min(3).max(500),
    }),
    handler: (input: { sessionId?: string; statement: string }) => {
      return getSession(input.sessionId).recordDecision(input.statement);
    },
  },
  {
    name: "apply_recovery_action",
    title: "Apply recovery action",
    description: "Apply a named recovery action. Unsafe or invalid actions are recorded and may change incident phase.",
    inputSchema: z.object({
      sessionId: sessionField,
      actionId: z.string().min(1),
    }),
    handler: (input: { sessionId?: string; actionId: string }) => {
      return getSession(input.sessionId).applyRecoveryAction(input.actionId);
    },
  },
  {
    name: "submit_diagnosis",
    title: "Submit final diagnosis",
    description: "Submit the trainee's diagnosis and evaluate whether scenario evidence supports it.",
    inputSchema: z.object({
      sessionId: sessionField,
      diagnosisId: z.string().min(1),
      rationale: z.string().min(3).max(1000),
      citedEvidenceIds: z.array(z.string().min(1)).max(32).optional(),
    }),
    handler: (input: {
      sessionId?: string;
      diagnosisId: string;
      rationale: string;
      citedEvidenceIds?: string[];
    }) => {
      return getSession(input.sessionId).submitDiagnosis(
        input.diagnosisId,
        input.rationale,
        input.citedEvidenceIds ?? [],
      );
    },
  },
  {
    name: "get_transcript",
    title: "Get auditable transcript",
    description: "Return the session transcript and evidence-backed score report.",
    inputSchema: z.object({ sessionId: sessionField }),
    handler: (input: { sessionId?: string }) => {
      const session = getSession(input.sessionId);
      return { state: session.getState(), score: session.score(), transcript: session.getTranscript() };
    },
  },
] as const;

export function invokeTool(name: string, raw: unknown) {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) return errorResult(new Error(`Unknown tool '${name}'.`));
  try {
    const input = tool.inputSchema.parse(raw);
    return jsonResult(tool.handler(input as never));
  } catch (error) {
    return errorResult(error);
  }
}

export function listTools() {
  return mcpTools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
  }));
}
