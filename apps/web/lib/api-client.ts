import { publicConfig } from "./config";

export interface ToolSummary {
  name: string;
  description: string;
  /** "planned" = contract only, "implemented" = real behaviour, "unknown" = server did not say. */
  status: "planned" | "implemented" | "unknown";
}

export interface ProviderStatus {
  configured: boolean;
  providerType: "llm" | "deterministic_fallback";
  model?: string;
}

export type ServerStatus =
  | {
      reachable: true;
      serverName: string;
      serverVersion: string;
      tools: ToolSummary[];
      provider?: ProviderStatus;
    }
  | { reachable: false; reason: string; provider?: ProviderStatus };

export interface ToolTraceEntry {
  tool: string;
  arguments: Record<string, unknown>;
  status: "success" | "error";
  durationMs: number;
  timestamp: string;
  summary?: string;
  error?: string;
}

export interface QuestionData {
  questionId: string;
  conceptId: string;
  kind: "multiple_choice" | "short_answer";
  prompt: string;
  choices?: string[];
  evidence: {
    chunkId: string;
    quote: string;
    status: "verified" | "unverified" | "rejected";
    start?: number;
    end?: number;
    sourceContext?: string;
    sourceTitle?: string;
  };
}

export interface EvidenceData {
  chunkId: string;
  quote: string;
  status: "verified" | "unverified" | "rejected";
  start?: number;
  end?: number;
  sourceContext?: string;
  sourceTitle?: string;
}

export interface EvaluationData {
  verdict: "correct" | "partially_correct" | "incorrect";
  explanation: string;
  misconceptionLabel?: string;
  recoveryCitation?: EvidenceData;
  misconceptionResolved?: boolean;
  resolvedMisconceptionLabel?: string;
  recoveryStatus?: "open" | "in_recovery" | "resolved";
}

export interface MasteryConcept {
  conceptId: string;
  mastery: number;
  attemptsCount: number;
  openMisconceptions: string[];
  nextReviewAt?: string;
}

export interface ExecutionMetadata {
  executionPath: "live_model" | "deterministic_fallback" | "mixed";
  provider?: string;
  model?: string;
  fallbackReason?: string;
  callCount?: number;
}

export interface SessionResponse {
  message: string;
  question?: QuestionData;
  evidence?: EvidenceData;
  evaluation?: EvaluationData;
  masteryList: MasteryConcept[];
  toolTraces: ToolTraceEntry[];
  provider?: "llm" | "deterministic_fallback";
  executionMetadata?: ExecutionMetadata;
}

/** Ask the web backend (which talks to the MCP server) what the MCP server reports. */
export async function fetchServerStatus(signal?: AbortSignal): Promise<ServerStatus> {
  const res = await fetch(publicConfig.statusEndpoint, { signal, cache: "no-store" });
  if (!res.ok) {
    return { reachable: false, reason: `Status request failed (HTTP ${res.status}).` };
  }
  return (await res.json()) as ServerStatus;
}

/** Load the learner's initial persisted mastery state and history. */
export async function fetchInitialState(signal?: AbortSignal): Promise<{
  masteryList: MasteryConcept[];
  toolTraces: ToolTraceEntry[];
}> {
  const res = await fetch(publicConfig.sessionEndpoint, { signal, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load initial state (HTTP ${res.status})`);
  }
  return (await res.json()) as { masteryList: MasteryConcept[]; toolTraces: ToolTraceEntry[] };
}

/** Start a revision session or request a quiz on a topic. */
export async function startSession(
  options: {
    topic?: string;
    focus?: "new" | "weak" | "review";
    documentId?: string;
    goal?: "teach" | "quiz" | "weak" | "full_document";
    sectionOrdinal?: number;
  } = {},
  signal?: AbortSignal,
): Promise<SessionResponse> {
  const res = await fetch(publicConfig.sessionEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start_session", ...options }),
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Request failed with status ${res.status}`);
  }

  return (await res.json()) as SessionResponse;
}

/** Submit a student answer for grading, verified evidence retrieval, and progress persistence. */
export async function submitAnswer(
  questionId: string,
  answer: string,
  optionsOrSignal?:
    | {
        recoveryForMisconceptionLabel?: string;
        clientAttemptId?: string;
        documentId?: string;
      }
    | AbortSignal,
  maybeSignal?: AbortSignal,
): Promise<SessionResponse> {
  const isSignal = optionsOrSignal instanceof AbortSignal;
  const options = isSignal ? undefined : optionsOrSignal;
  const signal = isSignal ? optionsOrSignal : maybeSignal;

  const res = await fetch(publicConfig.sessionEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "submit_answer",
      questionId,
      answer,
      recoveryForMisconceptionLabel: options?.recoveryForMisconceptionLabel,
      clientAttemptId: options?.clientAttemptId,
      documentId: options?.documentId,
    }),
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Answer submission failed with status ${res.status}`);
  }

  return (await res.json()) as SessionResponse;
}

// ---- Rapid-Fire Redemption types & API calls ------------------------------

export interface ChallengeSlotData {
  slotIndex: number;
  questionId: string;
  conceptId: string;
  question: {
    prompt: string;
    kind: "multiple_choice" | "short_answer";
    choices?: string[];
    evidence: {
      chunkId: string;
      quote: string;
      status: "verified" | "unverified" | "rejected";
      start?: number;
      end?: number;
    };
  };
  answered: boolean;
  verdict?: "correct" | "partially_correct" | "incorrect";
  explanation?: string;
}

export interface ChallengeState {
  challengeId: string;
  status: "active" | "completed" | "abandoned";
  score: number;
  totalSlots: number;
  startedAt: string;
  completedAt?: string;
  slots: ChallengeSlotData[];
  toolTraces: ToolTraceEntry[];
}

export interface AnswerSlotResult {
  slotIndex: number;
  verdict: "correct" | "partially_correct" | "incorrect";
  explanation: string;
  evidence: {
    chunkId: string;
    quote: string;
    status: "verified" | "unverified" | "rejected";
    start?: number;
    end?: number;
  };
  challenge: ChallengeState;
  toolTraces: ToolTraceEntry[];
}

export interface ChallengeRunSummary {
  id: string;
  status: string;
  score: number;
  totalSlots: number;
  startedAt: string;
  completedAt: string | null;
}

/** Start a 5-question Rapid-Fire Redemption run. */
export async function startChallenge(signal?: AbortSignal): Promise<ChallengeState> {
  const res = await fetch(publicConfig.challengeEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start" }),
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Challenge start failed with status ${res.status}`);
  }

  return (await res.json()) as ChallengeState;
}

/** Submit an answer for a specific question slot in a challenge run. */
export async function answerChallengeSlot(
  challengeId: string,
  slotIndex: number,
  answer: string,
  signal?: AbortSignal,
): Promise<AnswerSlotResult> {
  const res = await fetch(publicConfig.challengeEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "answer", challengeId, slotIndex, answer }),
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Answer submission failed with status ${res.status}`);
  }

  return (await res.json()) as AnswerSlotResult;
}

/** Fetch current state of a challenge run. */
export async function getChallengeState(
  challengeId: string,
  signal?: AbortSignal,
): Promise<ChallengeState> {
  const res = await fetch(publicConfig.challengeEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get_state", challengeId }),
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Challenge fetch failed with status ${res.status}`);
  }

  return (await res.json()) as ChallengeState;
}

/** List recent challenge runs. */
export async function listRecentChallenges(
  signal?: AbortSignal,
): Promise<{ runs: ChallengeRunSummary[] }> {
  const res = await fetch(publicConfig.challengeEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "list_recent" }),
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Failed to list challenges with status ${res.status}`);
  }

  return (await res.json()) as { runs: ChallengeRunSummary[] };
}

// ---- Document Library types & API calls -----------------------------------

export interface DocumentTopicSuggestion {
  id: string;
  label: string;
  topic: string;
  chunkId?: string;
}

export interface DocumentInfo {
  id: string;
  title: string;
  origin: "sample" | "student-upload";
  chunkCount: number;
  conceptCount: number;
  createdAt: string;
  suggestedTopics?: DocumentTopicSuggestion[];
}

export interface IngestionResult {
  fileName: string;
  success: boolean;
  documentId?: string;
  title?: string;
  chunkCount?: number;
  conceptCount?: number;
  error?: string;
}

/** Fetch all documents currently available in the student study library. */
export async function fetchDocuments(signal?: AbortSignal): Promise<DocumentInfo[]> {
  const timeoutSignal = AbortSignal.timeout(10000);
  const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const res = await fetch("/api/documents", { method: "GET", signal: effectiveSignal });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Failed to fetch documents with status ${res.status}`);
  }
  const data = (await res.json()) as { documents: DocumentInfo[] };
  return data.documents;
}

/** Fetch document topics specifically for a document. */
export async function fetchDocumentTopics(
  documentId: string,
  signal?: AbortSignal,
): Promise<{ topics: DocumentTopicSuggestion[]; document?: DocumentInfo }> {
  const timeoutSignal = AbortSignal.timeout(10000);
  const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const res = await fetch(`/api/documents?documentId=${encodeURIComponent(documentId)}`, {
    method: "GET",
    signal: effectiveSignal,
  });
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Failed to fetch topics with status ${res.status}`);
  }
  return (await res.json()) as { topics: DocumentTopicSuggestion[]; document?: DocumentInfo };
}

/** Upload one or multiple study files (.pdf, .txt, .md). */
export async function uploadDocuments(
  files: File[],
  signal?: AbortSignal,
): Promise<{ summary: string; results: IngestionResult[]; documents: DocumentInfo[] }> {
  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }

  const res = await fetch("/api/documents", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Upload failed with status ${res.status}`);
  }

  return (await res.json()) as {
    summary: string;
    results: IngestionResult[];
    documents: DocumentInfo[];
  };
}

/** Delete an uploaded study document by its documentId. */
export async function deleteDocument(
  documentId: string,
  signal?: AbortSignal,
): Promise<{ message: string; documents: DocumentInfo[] }> {
  const res = await fetch("/api/documents", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId }),
    signal,
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errorBody.message || `Delete failed with status ${res.status}`);
  }

  return (await res.json()) as { message: string; documents: DocumentInfo[] };
}
