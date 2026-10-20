import {
  DefaultEvidenceVerifier,
  filterQuestions,
  generateQuizInput,
  generateQuizOutput,
} from "@exam-sprint/core";
import type { ToolDefinition } from "./types";
import {
  DEFAULT_STUDENT_ID,
  loadChunks,
  loadQuestions,
  openDatabase,
  SqliteProgressStore,
} from "../db";
import { ToolError } from "../errors";

export const generateQuizTool: ToolDefinition<typeof generateQuizInput> = {
  name: "generate_quiz",
  status: "implemented",
  config: {
    title: "generate_quiz",
    description:
      "Produce questions grounded in retrieved notes, each with verified evidence from the source chunk.",
    inputSchema: generateQuizInput,
    outputSchema: generateQuizOutput,
    annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  },
  handler: async (input) => {
    const db = openDatabase();
    if (!db) {
      throw new ToolError("internal", "Database not initialized. Please run db:init first.");
    }

    try {
      const allQuestions = loadQuestions(db, input.conceptId);
      if (allQuestions.length === 0) {
        throw new ToolError("not_found", `No questions available for concept: ${input.conceptId}`);
      }

      const progressStore = new SqliteProgressStore(db);
      const attemptedQuestionIds = progressStore.getAttemptedQuestionIds(
        DEFAULT_STUDENT_ID,
        input.conceptId,
      );
      const openMisconceptions = new Set(
        progressStore.getOpenMisconceptions(DEFAULT_STUDENT_ID, input.conceptId),
      );

      const selectedQuestions = filterQuestions(allQuestions, input.conceptId, {
        focus: input.focus,
        count: input.count,
        attemptedQuestionIds,
        openMisconceptionLabels: openMisconceptions,
        targetedMisconceptionLabel: input.misconceptionLabel,
        excludeQuestionId: input.excludeQuestionId,
      });

      const chunks = loadChunks(db);
      const chunkMap = new Map(chunks.map((c) => [c.id, c]));
      const verifier = new DefaultEvidenceVerifier();

      const questions = selectedQuestions.map((q) => {
        const chunk = chunkMap.get(q.evidenceChunkId);
        const verification = verifier.verify(
          { chunkId: q.evidenceChunkId, quote: q.evidenceQuote },
          chunk,
        );

        if (verification.status !== "verified") {
          throw new ToolError(
            "invalid_state",
            `Evidence verification failed for question ${q.id} against chunk ${q.evidenceChunkId}`,
          );
        }

        return {
          questionId: q.id,
          conceptId: q.conceptId,
          kind: q.kind,
          prompt: q.prompt,
          choices: q.choices,
          evidence: {
            chunkId: q.evidenceChunkId,
            quote: q.evidenceQuote,
            status: "verified" as const,
            start: verification.reference.start,
            end: verification.reference.end,
          },
          targetMisconception: input.misconceptionLabel,
        };
      });

      const output = { questions };
      return {
        structuredContent: output,
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
      };
    } finally {
      db.close();
    }
  },
};
