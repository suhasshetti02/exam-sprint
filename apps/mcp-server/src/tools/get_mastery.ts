import { getMasteryInput, getMasteryOutput } from "@exam-sprint/core";
import type { ToolDefinition } from "./types";
import { DEFAULT_STUDENT_ID, openDatabase, SqliteProgressStore } from "../db";

export const getMasteryTool: ToolDefinition<typeof getMasteryInput> = {
  name: "get_mastery",
  status: "implemented",
  config: {
    title: "get_mastery",
    description:
      "Read the student's persisted mastery, attempts count, open misconceptions, and scheduled review date per concept.",
    inputSchema: getMasteryInput,
    outputSchema: getMasteryOutput,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  handler: async (input) => {
    const db = openDatabase();
    if (!db) {
      throw new Error("Database not initialized. Please run db:init first.");
    }

    try {
      const progressStore = new SqliteProgressStore(db);
      const masteryRecords = await progressStore.getMastery(
        DEFAULT_STUDENT_ID,
        input.conceptIds,
      );

      const concepts = masteryRecords.map((m) => {
        const openMisconceptions = progressStore.getOpenMisconceptions(
          DEFAULT_STUDENT_ID,
          m.conceptId,
        );

        return {
          conceptId: m.conceptId,
          mastery: m.mastery,
          attemptsCount: m.attemptsCount,
          openMisconceptions,
          nextReviewAt: m.nextReviewAt,
        };
      });

      const output = { concepts };
      return {
        structuredContent: output,
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
      };
    } finally {
      db.close();
    }
  },
};
