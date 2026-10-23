import { recordProgressInput, recordProgressOutput } from "@exam-sprint/core";
import type { ToolDefinition } from "./types";
import { DEFAULT_STUDENT_ID, openDatabase, SqliteProgressStore } from "../db";
import { ToolError } from "../errors";

export const recordProgressTool: ToolDefinition<typeof recordProgressInput> = {
  name: "record_progress",
  status: "implemented",
  config: {
    title: "record_progress",
    description:
      "Persist a graded attempt, update concept mastery according to documented scoring rules, track misconceptions, and schedule retests.",
    inputSchema: recordProgressInput,
    outputSchema: recordProgressOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  handler: async (input) => {
    const db = openDatabase();
    if (!db) {
      throw new ToolError("internal", "Database not initialized. Please run db:init first.");
    }

    try {
      const progressStore = new SqliteProgressStore(db);
      const update = await progressStore.recordAttempt({
        studentId: DEFAULT_STUDENT_ID,
        questionId: input.questionId,
        answer: input.answer,
        verdict: input.verdict,
        misconceptionLabel: input.misconceptionLabel,
        recoveryForMisconceptionLabel: input.recoveryForMisconceptionLabel,
        clientAttemptId: input.clientAttemptId,
      });

      const output = {
        attemptId: update.attemptId,
        mastery: update.mastery.mastery,
        nextReviewAt: update.mastery.nextReviewAt,
        retestScheduled: update.retestScheduled,
        misconceptionResolved: update.misconceptionResolved,
        resolvedMisconceptionLabel: update.resolvedMisconceptionLabel,
        recoveryStatus: update.recoveryStatus,
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
