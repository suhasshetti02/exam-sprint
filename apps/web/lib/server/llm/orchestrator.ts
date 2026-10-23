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
import { Bm25Retriever, DefaultEvidenceVerifier, type SourceChunk } from "@exam-sprint/core";
import { extractCleanSentences, openDb } from "../document-service";

export interface OrchestratorInput {
  action: "start_session" | "submit_answer";
  topic?: string;
  focus?: "new" | "weak" | "review";
  documentId?: string;
  goal?: "teach" | "quiz" | "weak" | "full_document";
  sectionOrdinal?: number;
  requestType?: "question";
  questionFormat?: "multiple_choice" | "short_answer";
  excludeQuestionId?: string;
  contextQuestion?: string;
  contextChunkId?: string;
  activeConceptId?: string;
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

  // Direct questions need an answer from the selected document, not the
  // deterministic topic-start template or a quiz-generating agent turn.
  if (input.action === "start_session" && input.requestType === "question" && input.documentId) {
    const directAnswer = await retrieveDocumentAnswerEvidence(
      input.documentId,
      input.topic || "",
      input.contextChunkId,
      input.contextQuestion,
    );
    const state = await loadInitialMasteryState(input.documentId).catch(() => ({ masteryList: [] }));
    const base = {
      question: undefined,
      evidence: directAnswer?.evidence,
      masteryList: state.masteryList,
      toolTraces: [],
    };

    if (!directAnswer) {
      return {
        ...base,
        message: `I couldn't find a relevant passage in the selected notes to answer "${input.topic || "that question"}". I won't guess; try a more specific question or another section.`,
        provider: "deterministic_fallback",
        executionMetadata: {
          executionPath: "deterministic_fallback",
          provider: "deterministic_policy",
          fallbackReason: "No relevant verified passage found",
          callCount: 0,
        },
      };
    }

    const insufficientMessage = `The notes for "${directAnswer.documentTitle}" don't clearly answer "${input.topic}". The closest relevant verified passage is: "${directAnswer.evidence.quote}"`;
    if (!directAnswer.answerable) {
      return {
        ...base,
        message: insufficientMessage,
        provider: "deterministic_fallback",
        executionMetadata: {
          executionPath: "deterministic_fallback",
          provider: "deterministic_policy",
          fallbackReason: "Relevant passage does not answer the requested definition",
          callCount: 0,
        },
      };
    }

    const deterministicMessage = `According to your notes, ${directAnswer.evidence.quote}`;
    if (provider?.isAvailable()) {
      try {
        const completion = await provider.generateCompletion([
          {
            role: "system",
            content: `You are StudyFlow, answering a student's direct question using only the verified passage provided from their selected study document. Answer the exact question in clear, concise language. The passage is the complete factual basis: do not add outside facts or claim details it does not support. If it does not answer the question, say that the notes do not provide enough information and quote the passage. Do not start a quiz, teach a different topic, or use a generic lesson template.`,
          },
          {
            role: "user",
            content: `Selected document: ${directAnswer.documentTitle}\nQuestion: ${input.topic}\nCurrent concept context: ${input.activeConceptId || "none"}\nVerified passage: "${directAnswer.evidence.quote}"`,
          },
        ], undefined, input.signal);
        const message = completion.content?.trim();
        if (message && completion.finishReason !== "error") {
          return {
            ...base,
            message,
            provider: "llm",
            executionMetadata: {
              executionPath: "live_model",
              provider: provider.id,
              model: provider.model,
              callCount: 1,
            },
          };
        }
        return {
          ...base,
          message: deterministicMessage,
          provider: "deterministic_fallback",
          executionMetadata: {
            executionPath: "deterministic_fallback",
            provider: "deterministic_policy",
            fallbackReason: "Live model returned no usable answer",
            callCount: 1,
          },
        };
      } catch (err: unknown) {
        const reason = err instanceof Error && /timeout|timed out|abort/i.test(err.message)
          ? "Live model request timed out"
          : "Live model request failed";
        return {
          ...base,
          message: deterministicMessage,
          provider: "deterministic_fallback",
          executionMetadata: {
            executionPath: "deterministic_fallback",
            provider: "deterministic_policy",
            fallbackReason: reason,
            callCount: 1,
          },
        };
      }
    }

    return {
      ...base,
      message: deterministicMessage,
      provider: "deterministic_fallback",
      executionMetadata: {
        executionPath: "deterministic_fallback",
        provider: "deterministic_policy",
        fallbackReason: provider ? "Provider is unavailable" : "No live AI provider configured",
        callCount: 0,
      },
    };
  }

  // If a document is specified, prioritize grounded retrieval from that document via startTutoringSession
  if (input.documentId && input.action === "start_session") {
    const res = await startTutoringSession({
      topic: input.topic,
      focus: input.focus,
      documentId: input.documentId,
      goal: input.goal,
      sectionOrdinal: input.sectionOrdinal,
      questionFormat: input.questionFormat,
      excludeQuestionId: input.excludeQuestionId,
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
      excludeQuestionId: input.excludeQuestionId,
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

interface DirectAnswerEvidence {
  documentTitle: string;
  answerable: boolean;
  evidence: NonNullable<SessionResponse["evidence"]>;
}

const QUESTION_STOP_WORDS = new Set([
  "what", "which", "who", "whom", "whose", "when", "where", "why", "how",
  "is", "are", "was", "were", "do", "does", "did", "can", "could", "would",
  "will", "the", "a", "an", "of", "to", "for", "in", "on", "with", "and",
  "or", "me", "my", "please", "explain", "define", "describe", "tell", "about",
  "mean", "means", "meaning", "called", "known", "according", "notes",
]);

async function retrieveDocumentAnswerEvidence(
  documentId: string,
  question: string,
  contextChunkId?: string,
  contextQuestion?: string,
): Promise<DirectAnswerEvidence | undefined> {
  const db = openDb();
  try {
    const document = db.prepare("SELECT title FROM documents WHERE id = ?").get(documentId) as { title: string } | undefined;
    if (!document) return undefined;
    const rows = db.prepare(
      "SELECT id, document_id, heading, ordinal, text FROM chunks WHERE document_id = ? ORDER BY ordinal ASC",
    ).all(documentId) as Array<{ id: string; document_id: string; heading: string; ordinal: number; text: string }>;
    const chunks: SourceChunk[] = rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      heading: row.heading,
      ordinal: row.ordinal,
      text: row.text,
    }));
    const isTopicOverview = /\b(?:overview|quick cover|summary|from scratch|beginning)\b/i.test(question);
    const retrievalQuestion = isTopicOverview && contextQuestion ? contextQuestion : question;
    const tokenTerms = retrievalQuestion.toLowerCase().match(/[a-z0-9]+/g) || [];
    const keyTerms = [...new Set(tokenTerms.filter((term) => term.length > 2 && !QUESTION_STOP_WORDS.has(term)))];
    const normalizedQuestion = question.trim().toLowerCase();
    const isDefinitionQuestion = /^(?:what|who)\b.*\b(?:is|are|was|were|means|mean|defined as)\b|^(?:define|what does .+ mean)\b/i.test(normalizedQuestion);

    const retriever = new Bm25Retriever(chunks);
    const ranked = await retriever.search(retrievalQuestion, 10, documentId);
    const contextChunk = contextChunkId ? chunks.find((chunk) => chunk.id === contextChunkId) : undefined;
    const rankedRows = ranked.map((hit) => ({ chunk: hit.chunk, score: hit.score }));
    if (contextChunk && !rankedRows.some(({ chunk }) => chunk.id === contextChunk.id)) {
      rankedRows.push({ chunk: contextChunk, score: 0 });
    }

    const definitionPattern = /\b(?:is|are|was|were)\s+(?:a|an|the)?\s*(?:field|process|study|method|system|technique|area|discipline|practice|representation|creation|use)\b|\b(?:refers? to|is defined as|means|describes?)\b/i;
    const candidates: Array<{ chunk: SourceChunk; quote: string; score: number; isDefinition: boolean; isObjective: boolean }> = [];
    for (const { chunk, score } of rankedRows) {
      const heading = chunk.heading.toLowerCase();
      if (/^(?:figure|fig\.?|table)\s*\d*/i.test(heading) || heading === document.title.toLowerCase()) continue;
      for (const sentence of extractCleanSentences(chunk.text)) {
        const lowerSentence = sentence.toLowerCase();
        const isObjective = /^(?:(?:in this (?:unit|chapter|section)|the objectives? (?:of|are)|learning objectives?|we aim to|the goal is to)\b|objectives?\s+in this\b)/i.test(sentence) ||
          /\b(?:learning )?objectives?\b|\bwe aim to\b|\bthe goal is to\b/i.test(heading);
        const matchedTerms = keyTerms.filter((term) => lowerSentence.includes(term)).length;
        const coverage = keyTerms.length === 0
          ? (contextChunk?.id === chunk.id ? 1 : 0)
          : matchedTerms / keyTerms.length;
        const isDefinition = definitionPattern.test(sentence);
        if (coverage < (keyTerms.length <= 2 ? 1 : 0.6)) continue;
        const definitionMatch = isDefinition ? lowerSentence.match(definitionPattern) : null;
        const conceptPhrase = keyTerms.join(" ");
        const conceptStart = conceptPhrase ? lowerSentence.lastIndexOf(conceptPhrase) : -1;
        const quote = isDefinition && conceptStart >= 0 && definitionMatch?.index !== undefined && conceptStart < definitionMatch.index
          ? sentence.slice(conceptStart).trim()
          : sentence;
        const verification = new DefaultEvidenceVerifier().verify({ chunkId: chunk.id, quote }, chunk);
        if (verification.status !== "verified") continue;
        candidates.push({
          chunk,
          quote: verification.reference.quote,
          isDefinition,
          isObjective,
          score: coverage * 10 + (isDefinition ? 5 : 0) + Math.min(score, 5) - (isObjective ? 5 : 0),
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const selected = (isDefinitionQuestion
      ? candidates.find((candidate) => candidate.isDefinition && !candidate.isObjective)
      : candidates.find((candidate) => !candidate.isObjective)) || candidates[0];
    if (!selected) return undefined;
    const verification = new DefaultEvidenceVerifier().verify(
      { chunkId: selected.chunk.id, quote: selected.quote },
      selected.chunk,
    );
    if (verification.status !== "verified") return undefined;
    return {
      documentTitle: document.title,
      answerable: !selected.isObjective && (!isDefinitionQuestion || selected.isDefinition),
      evidence: {
        chunkId: selected.chunk.id,
        quote: verification.reference.quote,
        status: "verified",
        start: verification.reference.start,
        end: verification.reference.end,
      },
    };
  } finally {
    db.close();
  }
}
