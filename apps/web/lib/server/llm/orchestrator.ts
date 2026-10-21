import { getLlmProvider } from "./providers";
import { runAgentTurn } from "./agent-loop";
import type { AgentTurnResult, LlmProvider } from "./types";
import {
  startTutoringSession,
  submitStudentAnswer,
  loadInitialMasteryState,
  type SessionResponse,
} from "../tutoring-policy";
import { isWeakConceptsRequest, resolveConceptId } from "../../topic-utils";
import { executeMcpTool } from "../mcp-client";
import type { GenerateQuizOutput, GetMasteryOutput } from "@exam-sprint/core";

export interface OrchestratorInput {
  action: "start_session" | "submit_answer";
  topic?: string;
  focus?: "new" | "weak" | "review";
  documentId?: string;
  goal?: "teach" | "quiz" | "weak" | "full_document";
  sectionOrdinal?: number;
  questionId?: string;
  answer?: string;
  recoveryForMisconceptionLabel?: string;
  clientAttemptId?: string;
  customProvider?: LlmProvider; // For testing and mocking
  signal?: AbortSignal;
}

/**
 * High-level server orchestrator.
 * Routes student requests through the LLM agent loop when an AI provider is configured,
 * or gracefully falls back to the deterministic tutoring policy.
 */
export async function runTutoringOrchestration(
  input: OrchestratorInput,
): Promise<SessionResponse> {
  const provider = input.customProvider !== undefined ? input.customProvider : getLlmProvider();

  // If a document is specified, prioritize grounded retrieval from that document via startTutoringSession
  if (input.documentId && input.action === "start_session") {
    const res = await startTutoringSession({
      topic: input.topic,
      focus: input.focus,
      documentId: input.documentId,
      goal: input.goal,
      sectionOrdinal: input.sectionOrdinal,
    });
    return {
      ...res,
      provider: "deterministic_fallback",
      executionMetadata: {
        executionPath: "deterministic_fallback",
        provider: "deterministic_policy",
        fallbackReason: "Document-grounded initial session",
        callCount: res.toolTraces?.length ?? 0,
      },
    };
  }

  // If a provider is configured and available, execute the bounded agent loop
  if (provider && provider.isAvailable()) {
    try {
      if (input.action === "start_session") {
        const rawTopic = input.topic?.trim();
        const isWeak = input.focus === "weak" || isWeakConceptsRequest(rawTopic);

        let targetConceptId: string | undefined;
        let weakReason: string | undefined;
        let userMessage: string;

        if (isWeak) {
          // Pre-resolve weak concept from real SQLite mastery
          let list: GetMasteryOutput["concepts"] = [];
          try {
            const masteryRes = await executeMcpTool<Record<string, never>, GetMasteryOutput>(
              "get_mastery",
              {},
            );
            list = masteryRes.result.concepts;
          } catch {
            list = [];
          }

          const specific = resolveConceptId(rawTopic);
          if (specific) {
            targetConceptId = specific;
            weakReason = `requested review on ${specific}`;
          } else {
            const withMisc = list.filter((m) => m.openMisconceptions.length > 0);
            if (withMisc.length > 0) {
              targetConceptId = withMisc[0]!.conceptId;
              weakReason = `open misconception: "${withMisc[0]!.openMisconceptions[0]}"`;
            } else {
              const weak = [...list]
                .filter((m) => m.attemptsCount > 0 && m.mastery < 0.75)
                .sort((a, b) => a.mastery - b.mastery);
              if (weak.length > 0) {
                targetConceptId = weak[0]!.conceptId;
                weakReason = `competency at ${Math.round(weak[0]!.mastery * 100)}%`;
              } else {
                const sorted = [...list].sort((a, b) => a.mastery - b.mastery);
                targetConceptId = sorted[0]?.conceptId ?? "normalization-basics";
                weakReason = "foundational syllabus review";
              }
            }
          }

          userMessage = `The student requested to review weak concepts. Target weak concept '${targetConceptId}' (${weakReason}). Call 'generate_quiz' with conceptId: '${targetConceptId}' and focus: 'weak' to provide a question from their study notes. Make this choice explicitly visible in your response.`;
        } else {
          targetConceptId = resolveConceptId(rawTopic);

          // If a topic was provided but could not be resolved to any supported syllabus concept:
          if (rawTopic && rawTopic.length > 0 && !targetConceptId) {
            const state = await loadInitialMasteryState().catch(() => ({ masteryList: [] }));
            return {
              message: `I couldn't find study notes or questions for "${rawTopic}". Please choose a syllabus topic such as 1NF, 2NF, 3NF, BCNF, Functional Dependencies, Normalization, ACID, or Isolation Levels.`,
              question: undefined,
              evidence: undefined,
              masteryList: state.masteryList,
              toolTraces: [],
              provider: "deterministic_fallback",
              executionMetadata: {
                executionPath: "deterministic_fallback",
                provider: "deterministic_policy",
                fallbackReason: "Unresolved syllabus topic",
                callCount: 0,
              },
            };
          }

          const cId = targetConceptId || "normalization-basics";
          targetConceptId = cId;
          userMessage = `Let's practice ${cId}. Call 'generate_quiz' with conceptId: '${cId}' to provide a verified question from study notes, and introduce the question.`;
        }

        const agentResult: AgentTurnResult = await runAgentTurn({
          provider,
          userMessage,
          action: "start_session",
          signal: input.signal,
        });

        // Guardrail: Ensure question and evidence are present, verified, and match targetConceptId
        let finalQuestion = agentResult.question;
        let finalEvidence = agentResult.evidence;
        const traces = [...agentResult.toolTraces];

        if (
          targetConceptId &&
          (!finalQuestion ||
            finalQuestion.conceptId !== targetConceptId ||
            finalQuestion.evidence?.status !== "verified")
        ) {
          try {
            const quizRes = await executeMcpTool<
              { conceptId: string; count: number; focus: "new" | "weak" | "review" },
              GenerateQuizOutput
            >("generate_quiz", { conceptId: targetConceptId, count: 1, focus: isWeak ? "weak" : "new" });
            traces.push(quizRes.trace);
            if (quizRes.result.questions.length > 0) {
              finalQuestion = quizRes.result.questions[0];
              finalEvidence = finalQuestion?.evidence;
            }
          } catch {
            // Non-fatal
          }
        }

        let finalMessage = agentResult.message;
        if (isWeak && weakReason && targetConceptId && !finalMessage.toLowerCase().includes(targetConceptId.toLowerCase())) {
          finalMessage = `Targeting weak concept: ${targetConceptId} (${weakReason}). ${finalMessage}`;
        }

        return {
          message: finalMessage,
          question: finalQuestion,
          evidence: finalEvidence,
          evaluation: undefined,
          masteryList: agentResult.masteryList,
          toolTraces: traces,
          provider: "llm",
          executionMetadata: {
            executionPath: "live_model",
            provider: provider.id,
            model: provider.model,
            callCount: traces.length,
          },
        };
      }

      // Answer submission
      const userMessage = input.answer || "";
      const agentResult: AgentTurnResult = await runAgentTurn({
        provider,
        userMessage,
        action: "submit_answer",
        questionId: input.questionId,
        recoveryForMisconceptionLabel: input.recoveryForMisconceptionLabel,
        clientAttemptId: input.clientAttemptId,
        documentId: input.documentId,
        signal: input.signal,
      });

      return {
        message: agentResult.message,
        question: agentResult.question,
        evidence: agentResult.evidence,
        evaluation: agentResult.evaluation,
        masteryList: agentResult.masteryList,
        toolTraces: agentResult.toolTraces,
        provider: "llm",
        executionMetadata: {
          executionPath: "live_model",
          provider: provider.id,
          model: provider.model,
          callCount: agentResult.toolTraces.length,
        },
      };
    } catch (err: unknown) {
      console.warn("LLM agent loop encountered error; engaging deterministic fallback:", err);
      // Fall through to deterministic policy below with safe fallback reason
    }
  }

  const fallbackReason = !provider
    ? "No live AI provider configured"
    : "Provider runtime error or timeout";

  // Deterministic Fallback Policy
  if (input.action === "start_session") {
    const fallbackRes = await startTutoringSession({
      topic: input.topic,
      focus: input.focus,
      documentId: input.documentId,
      goal: input.goal,
      sectionOrdinal: input.sectionOrdinal,
    });
    return {
      ...fallbackRes,
      provider: "deterministic_fallback",
      executionMetadata: {
        executionPath: "deterministic_fallback",
        provider: "deterministic_policy",
        fallbackReason,
        callCount: fallbackRes.toolTraces?.length ?? 0,
      },
    };
  }

  if (input.action === "submit_answer" && input.questionId && input.answer) {
    const fallbackRes = await submitStudentAnswer({
      questionId: input.questionId,
      answer: input.answer,
      recoveryForMisconceptionLabel: input.recoveryForMisconceptionLabel,
      clientAttemptId: input.clientAttemptId,
      documentId: input.documentId,
    });
    return {
      ...fallbackRes,
      provider: "deterministic_fallback",
      executionMetadata: {
        executionPath: "deterministic_fallback",
        provider: "deterministic_policy",
        fallbackReason,
        callCount: fallbackRes.toolTraces?.length ?? 0,
      },
    };
  }

  throw new Error("Invalid tutoring orchestration parameters.");
}
