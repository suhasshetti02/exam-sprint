import type { ToolDefinition } from "./types";
import { searchStudyNotesTool } from "./search_study_notes";
import { getMasteryTool } from "./get_mastery";
import { generateQuizTool } from "./generate_quiz";
import { evaluateAnswerTool } from "./evaluate_answer";
import { recordProgressTool } from "./record_progress";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const allTools: ToolDefinition<any>[] = [
  searchStudyNotesTool,
  getMasteryTool,
  generateQuizTool,
  evaluateAnswerTool,
  recordProgressTool,
];
