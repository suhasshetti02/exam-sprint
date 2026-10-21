/**
 * Explicit server-side tutoring policy (Milestone 3).
 * Sequences note retrieval, quiz generation, answer evaluation, and progress persistence
 * through real MCP tool calls. No LLM required.
 */

import { executeMcpTool, type ToolTraceEntry } from "./mcp-client";
import {
  isDontKnow,
  type EvaluateAnswerOutput,
  type GenerateQuizOutput,
  type GetMasteryOutput,
  type RecordProgressOutput,
  type SearchStudyNotesOutput,
  type SourceChunk,
} from "@exam-sprint/core";

export interface SessionResponse {
  message: string;
  question?: GenerateQuizOutput["questions"][0];
  evidence?: {
    chunkId: string;
    quote: string;
    status: "verified" | "unverified" | "rejected";
    start?: number;
    end?: number;
  };
  evaluation?: {
    verdict: "correct" | "partially_correct" | "incorrect";
    explanation: string;
    misconceptionLabel?: string;
    recoveryCitation?: {
      chunkId: string;
      quote: string;
      status: "verified" | "unverified" | "rejected";
      start?: number;
      end?: number;
    };
    misconceptionResolved?: boolean;
    resolvedMisconceptionLabel?: string;
    recoveryStatus?: "open" | "in_recovery" | "resolved";
  };
  masteryList: GetMasteryOutput["concepts"];
  toolTraces: ToolTraceEntry[];
  provider?: "llm" | "deterministic_fallback";
}

export { isWeakConceptsRequest, TOPIC_CONCEPT_MAP } from "../topic-utils";
import { isWeakConceptsRequest as checkWeak, resolveConceptId as resolveCanonicalConceptId } from "../topic-utils";

export function resolveConceptId(
  topic?: string,
  searchHits?: SearchStudyNotesOutput["results"],
): string | undefined {
  const topHeading = searchHits && searchHits.length > 0 && searchHits[0]?.score && searchHits[0].score > 0.5
    ? searchHits[0].heading
    : undefined;
  return resolveCanonicalConceptId(topic, topHeading);
}

import { createQuestionForChunk, headingToSlug, openDb } from "./document-service";

/**
 * Handles starting a revision session or requesting a quiz topic.
 */
export async function startTutoringSession(options: {
  topic?: string;
  focus?: "new" | "weak" | "review";
  documentId?: string;
  goal?: "teach" | "quiz" | "weak" | "full_document";
}): Promise<SessionResponse> {
  const toolTraces: ToolTraceEntry[] = [];
  const rawTopic = options.topic?.trim();
  const isWeak = options.focus === "weak" || checkWeak(rawTopic);

  // If a student-uploaded document is selected, prioritize its grounded material
  if (options.documentId) {
    try {
      const db = openDb();
      try {
        const doc = db
          .prepare("SELECT id, title, origin FROM documents WHERE id = ?")
          .get(options.documentId) as { id: string; title: string; origin: string } | undefined;

        if (doc && doc.origin === "student-upload") {
          const docQuestions = db
            .prepare(
              `SELECT q.id, q.concept_id as conceptId, q.kind, q.prompt, q.choices_json,
                      q.evidence_chunk_id, q.evidence_quote, q.evidence_start, q.evidence_end
               FROM questions q
               JOIN concepts c ON q.concept_id = c.id
               WHERE c.document_id = ?
               ORDER BY q.id`,
            )
            .all(doc.id) as Array<{
              id: string;
              conceptId: string;
              kind: "multiple_choice" | "short_answer";
              prompt: string;
              choices_json: string | null;
              evidence_chunk_id: string;
              evidence_quote: string;
              evidence_start: number;
              evidence_end: number;
            }>;

          if (docQuestions.length > 0) {
            let chosen: typeof docQuestions[0] | undefined = docQuestions[0]!;
            let chosenExcerpt = chosen.evidence_quote || "";
            let chosenExcerptChunkId = chosen.evidence_chunk_id;
            let targetHeading = "";

            const isFullDocGoal = options.goal === "full_document" || rawTopic === "full_document";
            const isWeakGoal = options.goal === "weak" || (rawTopic === "weak" || isWeak);

            if (isFullDocGoal) {
              // Full document study: traverse chunks sequentially by ordinal ASC
              const firstChunk = db
                .prepare(
                  "SELECT id, document_id, heading, ordinal, text FROM chunks WHERE document_id = ? ORDER BY ordinal ASC LIMIT 1",
                )
                .get(doc.id) as {
                  id: string;
                  document_id: string;
                  heading: string;
                  ordinal: number;
                  text: string;
                } | undefined;

              if (firstChunk) {
                targetHeading = firstChunk.heading;
                const matchedQ = docQuestions.find((q) => q.evidence_chunk_id === firstChunk.id);
                if (matchedQ) {
                  chosen = matchedQ;
                  chosenExcerpt = matchedQ.evidence_quote;
                  chosenExcerptChunkId = matchedQ.evidence_chunk_id;
                } else {
                  const conceptId = `${doc.id}__${headingToSlug(firstChunk.heading)}`;
                  const firstChunkChunk: SourceChunk = {
                    id: firstChunk.id,
                    documentId: firstChunk.document_id,
                    heading: firstChunk.heading,
                    ordinal: firstChunk.ordinal,
                    text: firstChunk.text,
                  };
                  const docSiblingRows = db
                    .prepare(
                      "SELECT id, document_id, heading, ordinal, text FROM chunks WHERE document_id = ?",
                    )
                    .all(doc.id) as Array<{
                      id: string;
                      document_id: string;
                      heading: string;
                      ordinal: number;
                      text: string;
                    }>;
                  const allDocChunks: SourceChunk[] = docSiblingRows.map((r) => ({
                    id: r.id,
                    documentId: r.document_id,
                    heading: r.heading,
                    ordinal: r.ordinal,
                    text: r.text,
                  }));
                  const tailoredQ = createQuestionForChunk(firstChunkChunk, conceptId, undefined, allDocChunks);
                  if (tailoredQ) {
                    chosen = {
                      id: tailoredQ.id,
                      conceptId: tailoredQ.conceptId,
                      kind: tailoredQ.kind,
                      prompt: tailoredQ.prompt,
                      choices_json: JSON.stringify(tailoredQ.choices),
                      evidence_chunk_id: firstChunk.id,
                      evidence_quote: tailoredQ.evidenceQuote,
                      evidence_start: tailoredQ.evidenceStart,
                      evidence_end: tailoredQ.evidenceEnd,
                    };
                    chosenExcerpt = firstChunk.text;
                    chosenExcerptChunkId = firstChunk.id;
                  }
                }
              }
            } else if (isWeakGoal && (!rawTopic || rawTopic === "weak")) {
              // Weak concept revision: select document-scoped concept with open misconceptions or lowest mastery
              const weakConceptRow = db
                .prepare(`
                  SELECT c.id, c.heading, m.competency, m.open_misconceptions_json
                  FROM concepts c
                  LEFT JOIN mastery m ON c.id = m.concept_id
                  WHERE c.document_id = ?
                  ORDER BY (CASE WHEN m.open_misconceptions_json IS NOT NULL AND m.open_misconceptions_json != '[]' THEN 0 ELSE 1 END),
                           COALESCE(m.competency, 0.0) ASC
                  LIMIT 1
                `)
                .get(doc.id) as { id: string; heading: string; competency: number | null; open_misconceptions_json: string | null } | undefined;

              if (weakConceptRow) {
                targetHeading = weakConceptRow.heading;
                const matchedQ = docQuestions.find((q) => q.conceptId === weakConceptRow.id);
                if (matchedQ) {
                  chosen = matchedQ;
                  chosenExcerpt = matchedQ.evidence_quote;
                  chosenExcerptChunkId = matchedQ.evidence_chunk_id;
                }
              }
            } else if (rawTopic && rawTopic !== "weak" && rawTopic !== "full_document") {
              // Retrieve matching study notes scoped to this document via real MCP search_study_notes
              let searchHits: SearchStudyNotesOutput["results"] = [];
              try {
                const searchRes = await executeMcpTool<
                  { query: string; limit: number; documentId?: string },
                  SearchStudyNotesOutput
                >("search_study_notes", {
                  query: rawTopic,
                  limit: 5,
                  documentId: doc.id,
                });
                searchHits = searchRes.result.results;
                toolTraces.push(searchRes.trace);
              } catch (err: unknown) {
                if (err && typeof err === "object" && "trace" in err) {
                  toolTraces.push((err as { trace: ToolTraceEntry }).trace);
                }
              }

              // Filter hits strictly to this document
              const relevantHits = searchHits.filter((h) => h.documentId === doc.id && h.score > 0);

              if (relevantHits.length > 0) {
                const topHit = relevantHits[0]!;
                const chunkRow = db
                  .prepare("SELECT id, document_id, heading, ordinal, text FROM chunks WHERE id = ?")
                  .get(topHit.chunkId) as {
                    id: string;
                    document_id: string;
                    heading: string;
                    ordinal: number;
                    text: string;
                  } | undefined;

                if (chunkRow) {
                  targetHeading = chunkRow.heading;
                  const chunk: SourceChunk = {
                    id: chunkRow.id,
                    documentId: chunkRow.document_id,
                    heading: chunkRow.heading,
                    ordinal: chunkRow.ordinal,
                    text: chunkRow.text,
                  };
                  const conceptId = `${doc.id}__${headingToSlug(chunk.heading)}`;
                  const docSiblingRows = db
                    .prepare(
                      "SELECT id, document_id, heading, ordinal, text FROM chunks WHERE document_id = ?",
                    )
                    .all(doc.id) as Array<{
                      id: string;
                      document_id: string;
                      heading: string;
                      ordinal: number;
                      text: string;
                    }>;
                  const allDocChunks: SourceChunk[] = docSiblingRows.map((r) => ({
                    id: r.id,
                    documentId: r.document_id,
                    heading: r.heading,
                    ordinal: r.ordinal,
                    text: r.text,
                  }));
                  const tailoredQ = createQuestionForChunk(chunk, conceptId, rawTopic, allDocChunks);
                  if (tailoredQ) {
                    const nowIso = new Date().toISOString();
                    db.prepare(
                      `INSERT OR REPLACE INTO questions (
                        id, concept_id, kind, prompt, choices_json, expected_json,
                        evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    ).run(
                      tailoredQ.id,
                      tailoredQ.conceptId,
                      tailoredQ.kind,
                      tailoredQ.prompt,
                      JSON.stringify(tailoredQ.choices),
                      JSON.stringify(tailoredQ.expected),
                      chunk.id,
                      tailoredQ.evidenceQuote,
                      tailoredQ.evidenceStart,
                      tailoredQ.evidenceEnd,
                      nowIso,
                    );
                    chosen = {
                      id: tailoredQ.id,
                      conceptId: tailoredQ.conceptId,
                      kind: tailoredQ.kind,
                      prompt: tailoredQ.prompt,
                      choices_json: JSON.stringify(tailoredQ.choices),
                      evidence_chunk_id: chunk.id,
                      evidence_quote: tailoredQ.evidenceQuote,
                      evidence_start: tailoredQ.evidenceStart,
                      evidence_end: tailoredQ.evidenceEnd,
                    };
                    chosenExcerpt = chunk.text;
                    chosenExcerptChunkId = chunk.id;
                  } else {
                    chosen = undefined;
                    chosenExcerpt = chunk.text;
                    chosenExcerptChunkId = chunk.id;
                  }
                } else {
                  const matched = docQuestions.find((q) => q.evidence_chunk_id === topHit.chunkId);
                  if (matched) {
                    chosen = matched;
                    chosenExcerpt = matched.evidence_quote;
                    chosenExcerptChunkId = matched.evidence_chunk_id;
                  }
                }
              } else {
                return {
                  message: `I couldn't find grounded notes for "${rawTopic}" in your document "${doc.title}". Please ask about topics covered in this document.`,
                  question: undefined,
                  evidence: undefined,
                  masteryList: [],
                  toolTraces,
                  provider: "deterministic_fallback",
                };
              }
            }

            if (!chosen) {
              return {
                message: `I retrieved relevant notes for "${rawTopic || doc.title}" from "${doc.title}", but there is insufficient context in this section to safely generate a multi-choice question without guessing. Here is the verified note excerpt for your review:\n\n"${chosenExcerpt.slice(0, 300)}"`,
                question: undefined,
                evidence: chosenExcerpt
                  ? {
                      chunkId: chosenExcerptChunkId,
                      quote: chosenExcerpt.slice(0, Math.min(chosenExcerpt.length, 150)),
                      status: "verified" as const,
                      start: 0,
                      end: Math.min(chosenExcerpt.length, 150),
                    }
                  : undefined,
                masteryList: [],
                toolTraces,
                provider: "deterministic_fallback",
              };
            }

            const choices = chosen.choices_json ? JSON.parse(chosen.choices_json) : undefined;
            const fullChunkRow = db
              .prepare("SELECT text FROM chunks WHERE id = ?")
              .get(chosen.evidence_chunk_id) as { text: string } | undefined;

            const questionData = {
              questionId: chosen.id,
              conceptId: chosen.conceptId,
              kind: chosen.kind,
              prompt: chosen.prompt,
              choices,
              evidence: {
                chunkId: chosen.evidence_chunk_id,
                quote: chosen.evidence_quote,
                status: "verified" as const,
                start: chosen.evidence_start,
                end: chosen.evidence_end,
                sourceContext: fullChunkRow?.text || chosenExcerpt || undefined,
              },
            };

            let welcomeMsg = `Welcome to your study session on "${doc.title}". Here is a question directly grounded in your uploaded notes:`;
            if (options.goal === "teach") {
              const topicLabel = targetHeading || doc.title;
              welcomeMsg = `Let's study "${topicLabel}". Here is the core concept from your notes:\n\n"${chosen.evidence_quote}"\n\nTo check your understanding of this concept, let's explore this question:`;
            } else if (options.goal === "weak") {
              welcomeMsg = `Focusing on weak-concept revision for "${doc.title}":`;
            } else if (options.goal === "full_document") {
              welcomeMsg = `Starting section-by-section study of "${doc.title}". Let's begin with section 1 (${targetHeading || "Overview"}):`;
            }

            return {
              message: welcomeMsg,
              question: questionData,
              evidence: questionData.evidence,
              masteryList: [],
              toolTraces,
              provider: "deterministic_fallback",
            };
          }
        }
      } finally {
        db.close();
      }
    } catch {
      // Fall through to standard syllabus flow
    }
  }

  // Step 1: Fetch current mastery to inform adaptive selection
  let masteryList: GetMasteryOutput["concepts"] = [];
  try {
    const masteryRes = await executeMcpTool<
      Record<string, never>,
      GetMasteryOutput
    >("get_mastery", {});
    masteryList = masteryRes.result.concepts;
    toolTraces.push(masteryRes.trace);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
  }

  let targetConceptId: string | undefined;
  let focus = options.focus ?? "new";
  let weakSelectionReason: string | undefined;

  if (isWeak) {
    focus = "weak";
    // Check if a specific concept was also mentioned alongside weak request (e.g. "weak 2nf")
    const specificConcept = resolveConceptId(rawTopic);
    if (specificConcept) {
      targetConceptId = specificConcept;
      weakSelectionReason = `requested review on ${specificConcept}`;
    } else {
      // Find concept with open misconceptions
      const withMisc = masteryList.filter((m) => m.openMisconceptions.length > 0);
      if (withMisc.length > 0) {
        targetConceptId = withMisc[0]!.conceptId;
        weakSelectionReason = `open misconception: "${withMisc[0]!.openMisconceptions[0]}"`;
      } else {
        const weak = [...masteryList]
          .filter((m) => m.attemptsCount > 0 && m.mastery < 0.75)
          .sort((a, b) => a.mastery - b.mastery);
        if (weak.length > 0) {
          targetConceptId = weak[0]!.conceptId;
          weakSelectionReason = `competency at ${Math.round(weak[0]!.mastery * 100)}%`;
        } else {
          // If no attempts or all >= 0.75, select concept with lowest mastery or first concept
          const sorted = [...masteryList].sort((a, b) => a.mastery - b.mastery);
          targetConceptId = sorted[0]?.conceptId ?? "normalization-basics";
          weakSelectionReason = "foundational syllabus review";
        }
      }
    }
  } else if (options.goal === "full_document" || rawTopic === "full_document") {
    targetConceptId = "normalization-basics";
  } else {
    // Retrieve study notes to assist resolution if needed
    let searchHits: SearchStudyNotesOutput["results"] = [];
    if (rawTopic) {
      try {
        const searchRes = await executeMcpTool<
          { query: string; limit: number },
          SearchStudyNotesOutput
        >("search_study_notes", { query: rawTopic, limit: 3 });
        searchHits = searchRes.result.results;
        toolTraces.push(searchRes.trace);
      } catch (err: unknown) {
        if (err && typeof err === "object" && "trace" in err) {
          toolTraces.push((err as { trace: ToolTraceEntry }).trace);
        }
      }
    }

    targetConceptId = resolveConceptId(rawTopic, searchHits);
  }

  // When a topic is unsupported or cannot be resolved, return a clear recoverable message
  // Do NOT silently display an unrelated default question!
  if (!targetConceptId) {
    return {
      message: `I couldn't find study notes or questions for "${rawTopic}". Please choose a syllabus topic such as 1NF, 2NF, 3NF, BCNF, Functional Dependencies, Normalization, ACID, or Isolation Levels.`,
      question: undefined,
      evidence: undefined,
      masteryList,
      toolTraces,
    };
  }

  // Step 2: Generate quiz question grounded in verified notes
  let question: GenerateQuizOutput["questions"][0] | undefined;
  try {
    const quizRes = await executeMcpTool<
      { conceptId: string; count: number; focus: "new" | "weak" | "review" },
      GenerateQuizOutput
    >("generate_quiz", { conceptId: targetConceptId, count: 1, focus });
    toolTraces.push(quizRes.trace);
    question = quizRes.result.questions[0];
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
    return {
      message: `No verified questions could be loaded for concept "${targetConceptId}". Please try another topic.`,
      question: undefined,
      evidence: undefined,
      masteryList,
      toolTraces,
      provider: "deterministic_fallback",
    };
  }

  if (!question) {
    return {
      message: `No questions available for concept "${targetConceptId}". Please try another topic.`,
      question: undefined,
      evidence: undefined,
      masteryList,
      toolTraces,
      provider: "deterministic_fallback",
    };
  }

  // Double-check question evidence is verified
  const evidence = question.evidence?.status === "verified" ? question.evidence : undefined;
  if (!evidence) {
    return {
      message: `Question evidence could not be verified against the study notes for concept "${targetConceptId}".`,
      question: undefined,
      evidence: undefined,
      masteryList,
      toolTraces,
      provider: "deterministic_fallback",
    };
  }

  // Ensure sourceContext is attached from chunks table if not already present
  if (!evidence.sourceContext) {
    try {
      const db = openDb();
      try {
        const chunkRow = db.prepare("SELECT text FROM chunks WHERE id = ?").get(evidence.chunkId) as { text: string } | undefined;
        if (chunkRow?.text) {
          (evidence as { sourceContext?: string }).sourceContext = chunkRow.text;
        }
      } finally {
        db.close();
      }
    } catch {
      // Non-fatal
    }
  }

  let tutorMessage = "";
  if (options.goal === "teach") {
    tutorMessage = `Let's study ${targetConceptId}. Here is the core concept from the syllabus:\n\n"${question.evidence?.quote || ""}"\n\nTo check your understanding of this concept, let's explore this question:`;
  } else if (isWeak) {
    tutorMessage = `Targeting weak concept: ${targetConceptId} (${weakSelectionReason}). Here is a question to test and reinforce your understanding:`;
  } else if (options.goal === "full_document") {
    tutorMessage = `Starting comprehensive full-syllabus review with ${targetConceptId}:`;
  } else {
    tutorMessage = `Let's revise ${targetConceptId}. Here is a question from your study notes:`;
  }

  return {
    message: tutorMessage,
    question,
    evidence: question.evidence,
    masteryList,
    toolTraces,
    provider: "deterministic_fallback",
  };
}

/**
 * Handles grading a student's answer and recording progress in SQLite.
 */
export async function submitStudentAnswer(options: {
  questionId: string;
  answer: string;
  recoveryForMisconceptionLabel?: string;
}): Promise<SessionResponse> {
  const toolTraces: ToolTraceEntry[] = [];

  // Step 1: Evaluate answer (read-only)
  let evaluation: EvaluateAnswerOutput;
  try {
    const evalRes = await executeMcpTool<
      { questionId: string; answer: string },
      EvaluateAnswerOutput
    >("evaluate_answer", { questionId: options.questionId, answer: options.answer });
    evaluation = evalRes.result;
    toolTraces.push(evalRes.trace);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
    throw err;
  }

  // Step 2: Persist progress through record_progress
  let progressResult: RecordProgressOutput | undefined;
  try {
    const progressRes = await executeMcpTool<
      {
        questionId: string;
        answer: string;
        verdict: "correct" | "partially_correct" | "incorrect";
        misconceptionLabel?: string;
        recoveryForMisconceptionLabel?: string;
      },
      RecordProgressOutput
    >("record_progress", {
      questionId: options.questionId,
      answer: options.answer,
      verdict: evaluation.verdict,
      misconceptionLabel: evaluation.misconceptionLabel,
      recoveryForMisconceptionLabel: options.recoveryForMisconceptionLabel,
    });
    progressResult = progressRes.result;
    toolTraces.push(progressRes.trace);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
    throw err;
  }

  // Step 3: Fetch updated mastery
  let masteryList: GetMasteryOutput["concepts"] = [];
  try {
    const masteryRes = await executeMcpTool<
      Record<string, never>,
      GetMasteryOutput
    >("get_mastery", {});
    masteryList = masteryRes.result.concepts;
    toolTraces.push(masteryRes.trace);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
  }

  const isDontKnowAnswer = isDontKnow(options.answer);

  // Step 4: Targeted recovery or follow-up question generation
  let followUpQuestion: GenerateQuizOutput["questions"][0] | undefined;
  const isMisconceptionIncorrect = evaluation.verdict === "incorrect" && evaluation.misconceptionLabel;

  if (isMisconceptionIncorrect && evaluation.conceptId) {
    // Diagnosed a misconception: generate a targeted recovery question addressing this exact misconception
    try {
      const quizRes = await executeMcpTool<
        {
          conceptId: string;
          count: number;
          focus: "new" | "weak" | "review";
          misconceptionLabel?: string;
          excludeQuestionId?: string;
        },
        GenerateQuizOutput
      >("generate_quiz", {
        conceptId: evaluation.conceptId,
        count: 1,
        focus: "weak",
        misconceptionLabel: evaluation.misconceptionLabel,
        excludeQuestionId: options.questionId,
      });
      toolTraces.push(quizRes.trace);
      followUpQuestion = quizRes.result.questions[0];
    } catch (err: unknown) {
      if (err && typeof err === "object" && "trace" in err) {
        toolTraces.push((err as { trace: ToolTraceEntry }).trace);
      }
    }
  } else if (isDontKnowAnswer && evaluation.conceptId) {
    try {
      const quizRes = await executeMcpTool<
        {
          conceptId: string;
          count: number;
          focus: "new" | "weak" | "review";
          excludeQuestionId?: string;
        },
        GenerateQuizOutput
      >("generate_quiz", {
        conceptId: evaluation.conceptId,
        count: 1,
        focus: "new",
        excludeQuestionId: options.questionId,
      });
      toolTraces.push(quizRes.trace);
      followUpQuestion = quizRes.result.questions[0];
    } catch (err: unknown) {
      if (err && typeof err === "object" && "trace" in err) {
        toolTraces.push((err as { trace: ToolTraceEntry }).trace);
      }
    }
  }

  let tutorMessage = "";
  if (isMisconceptionIncorrect) {
    const notePassage = evaluation.recoveryCitation?.quote
      ? `\n\nFrom your study notes (${evaluation.recoveryCitation.chunkId}):\n"${evaluation.recoveryCitation.quote}"`
      : "";
    tutorMessage = `Not quite. Diagnosed misconception: "${evaluation.misconceptionLabel}". ${evaluation.explanation}${notePassage}\n\nHere is a targeted follow-up question to test this specific distinction:`;
  } else if (isDontKnowAnswer) {
    tutorMessage = `${evaluation.explanation}\n\nHere is a follow-up question to test this concept:`;
  } else if (evaluation.verdict === "correct") {
    if (progressResult?.misconceptionResolved) {
      tutorMessage = `Spot on! ✓ Misconception resolved: "${progressResult.resolvedMisconceptionLabel}". ${evaluation.explanation}`;
    } else {
      tutorMessage = `Spot on! ${evaluation.explanation}`;
    }
  } else if (evaluation.verdict === "partially_correct") {
    tutorMessage = `Partially correct. ${evaluation.explanation}`;
  } else {
    tutorMessage = `Not quite. ${evaluation.explanation}`;
  }

  return {
    message: tutorMessage,
    question: followUpQuestion,
    evidence: followUpQuestion ? followUpQuestion.evidence : (evaluation.recoveryCitation || evaluation.evidence),
    evaluation: {
      verdict: evaluation.verdict,
      explanation: evaluation.explanation,
      misconceptionLabel: evaluation.misconceptionLabel,
      recoveryCitation: evaluation.recoveryCitation,
      misconceptionResolved: progressResult?.misconceptionResolved,
      resolvedMisconceptionLabel: progressResult?.resolvedMisconceptionLabel,
      recoveryStatus: progressResult?.recoveryStatus,
    },
    masteryList,
    toolTraces,
  };
}

/**
 * Loads the current persisted mastery state for the learner.
 */
export async function loadInitialMasteryState(): Promise<{
  masteryList: GetMasteryOutput["concepts"];
  toolTraces: ToolTraceEntry[];
}> {
  const toolTraces: ToolTraceEntry[] = [];
  try {
    const masteryRes = await executeMcpTool<
      Record<string, never>,
      GetMasteryOutput
    >("get_mastery", {});
    toolTraces.push(masteryRes.trace);
    return { masteryList: masteryRes.result.concepts, toolTraces };
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
    return { masteryList: [], toolTraces };
  }
}
