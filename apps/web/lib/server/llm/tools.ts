import type { LlmToolDefinition } from "./types";

export const TUTOR_LLM_TOOLS: LlmToolDefinition[] = [
  {
    name: "search_study_notes",
    description:
      "Retrieve relevant study note passages from the student's personal notes using BM25 keyword search.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords or concepts to locate in notes (e.g. 'BCNF superkey', 'durability commit').",
        },
        limit: {
          type: "number",
          description: "Maximum number of note chunks to return (default: 3).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_mastery",
    description:
      "Retrieve persistent concept mastery levels, attempt counts, and open misconceptions from SQLite.",
    parameters: {
      type: "object",
      properties: {
        conceptIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of concept IDs to filter by.",
        },
      },
    },
  },
  {
    name: "generate_quiz",
    description:
      "Generate an evidence-grounded question for a concept. Every question includes verified evidence quotations.",
    parameters: {
      type: "object",
      properties: {
        conceptId: {
          type: "string",
          enum: [
            "1nf",
            "2nf",
            "3nf",
            "bcnf",
            "functional-dependencies",
            "normalization-basics",
            "acid",
            "isolation-levels",
          ],
          description: "The syllabus concept ID.",
        },
        focus: {
          type: "string",
          enum: ["new", "weak", "review"],
          description: "Selection mode: 'new' (unattempted), 'weak' (targets diagnosed misconceptions), 'review' (spaced review).",
        },
        count: {
          type: "number",
          description: "Number of questions to generate (default: 1).",
        },
      },
      required: ["conceptId"],
    },
  },
  {
    name: "evaluate_answer",
    description:
      "Strictly evaluate a student answer against verified ground-truth rubrics and diagnose misconceptions. Read-only query.",
    parameters: {
      type: "object",
      properties: {
        questionId: {
          type: "string",
          description: "The ID of the question being answered.",
        },
        answer: {
          type: "string",
          description: "The student's submitted answer text or option choice.",
        },
      },
      required: ["questionId", "answer"],
    },
  },
  {
    name: "record_progress",
    description:
      "Persist the evaluated result into SQLite, deterministically updating concept mastery and managing misconception lifecycles.",
    parameters: {
      type: "object",
      properties: {
        questionId: {
          type: "string",
          description: "The ID of the question.",
        },
        answer: {
          type: "string",
          description: "The student's submitted answer.",
        },
        verdict: {
          type: "string",
          enum: ["correct", "partially_correct", "incorrect"],
          description: "The evaluated verdict.",
        },
        misconceptionLabel: {
          type: "string",
          description: "Optional diagnosed misconception label from evaluate_answer.",
        },
      },
      required: ["questionId", "answer", "verdict"],
    },
  },
];
