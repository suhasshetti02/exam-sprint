import {
  DefaultEvidenceVerifier,
  DeterministicAnswerEvaluator,
  evaluateAnswerInput,
  evaluateAnswerOutput,
} from "@exam-sprint/core";
import type { ToolDefinition } from "./types";
import { getQuestionById, loadChunks, openDatabase } from "../db";
import { ToolError } from "../errors";

export const evaluateAnswerTool: ToolDefinition<typeof evaluateAnswerInput> = {
  name: "evaluate_answer",
  status: "implemented",
  config: {
    title: "evaluate_answer",
    description:
      "Evaluate a student answer against deterministic rubrics and return verified supporting evidence. Does not update mastery.",
    inputSchema: evaluateAnswerInput,
    outputSchema: evaluateAnswerOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  handler: async (input) => {
    const db = openDatabase();
    if (!db) {
      throw new ToolError("internal", "Database not initialized. Please run db:init first.");
    }

    try {
      const question = getQuestionById(db, input.questionId);
      if (!question) {
        throw new ToolError("not_found", `Question not found: ${input.questionId}`);
      }

      const chunks = loadChunks(db);
      const chunk = chunks.find((c) => c.id === question.evidenceChunkId);

      const verifier = new DefaultEvidenceVerifier();
      const evaluator = new DeterministicAnswerEvaluator(verifier);

      const result = evaluator.evaluate(question, input.answer, chunk);

      // If this is an incorrect answer with a diagnosed misconception, find and verify note evidence
      let recoveryCitation:
        | {
            chunkId: string;
            quote: string;
            status: "verified" | "unverified" | "rejected";
            start?: number;
            end?: number;
          }
        | undefined;

      if (result.verdict === "incorrect" && result.misconceptionLabel) {
        // The question's evidence chunk provides the verified authoritative passage for this concept
        if (chunk && question.evidenceQuote) {
          const v = verifier.verify(
            { chunkId: question.evidenceChunkId, quote: question.evidenceQuote },
            chunk,
          );
          if (v.status === "verified") {
            recoveryCitation = {
              chunkId: question.evidenceChunkId,
              quote: question.evidenceQuote,
              status: "verified",
              start: v.reference.start,
              end: v.reference.end,
            };
          }
        }
      }

      const output = {
        verdict: result.verdict,
        explanation: result.explanation,
        evidence: {
          chunkId: result.evidence.chunkId,
          quote: result.evidence.quote,
          status: result.evidence.status,
          start: result.evidence.start,
          end: result.evidence.end,
        },
        misconceptionLabel: result.misconceptionLabel,
        conceptId: question.conceptId,
        recoveryCitation,
      };

      return {
        structuredContent: output,
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
      };
    } finally {
      db.close();
    }
  },
};
