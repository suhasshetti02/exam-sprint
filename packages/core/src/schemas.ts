import { z } from "zod";

/** Zod contracts for the five planned MCP tools. See MCP_TOOLS.md. */

export const evidenceReferenceSchema = z.object({
  chunkId: z.string().min(1),
  quote: z.string().min(1).max(600),
});

export const verifiedEvidenceSchema = evidenceReferenceSchema.extend({
  status: z.enum(["verified", "unverified", "rejected"]),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  sourceContext: z.string().optional(),
});

const conceptId = z.string().min(1).max(80);

// --- search_study_notes ---
export const searchStudyNotesInput = z.object({
  query: z.string().trim().min(2).max(300),
  limit: z.number().int().min(1).max(10).default(5),
  documentId: z.string().optional(),
});
export const searchStudyNotesOutput = z.object({
  results: z.array(
    z.object({
      chunkId: z.string(),
      documentId: z.string(),
      heading: z.string(),
      text: z.string(),
      score: z.number(),
    }),
  ),
});

// --- get_mastery ---
export const getMasteryInput = z.object({
  conceptIds: z.array(conceptId).max(50).optional(),
  documentId: z.string().max(100).optional(),
});
export const getMasteryOutput = z.object({
  concepts: z.array(
    z.object({
      conceptId: z.string(),
      mastery: z.number().min(0).max(1),
      attemptsCount: z.number().int().nonnegative(),
      openMisconceptions: z.array(z.string()),
      nextReviewAt: z.string().optional(),
    }),
  ),
});

// --- generate_quiz ---
export const generateQuizInput = z.object({
  conceptId,
  count: z.number().int().min(1).max(5).default(1),
  /** Prefer concepts with open misconceptions or overdue reviews. */
  focus: z.enum(["new", "weak", "review"]).default("new"),
  /** Specific misconception label to target for recovery loop. */
  misconceptionLabel: z.string().max(80).optional(),
  /** Question ID to exclude (e.g. avoid repeating the just-failed question in recovery follow-up). */
  excludeQuestionId: z.string().max(80).optional(),
});
export const generateQuizOutput = z.object({
  questions: z.array(
    z.object({
      questionId: z.string(),
      conceptId: z.string(),
      kind: z.enum(["multiple_choice", "short_answer"]),
      prompt: z.string(),
      choices: z.array(z.string()).optional(),
      evidence: verifiedEvidenceSchema,
      targetMisconception: z.string().optional(),
    }),
  ),
});

// --- evaluate_answer ---
export const evaluateAnswerInput = z.object({
  questionId: z.string().min(1).max(80),
  answer: z.string().trim().min(1).max(2000),
});
export const evaluateAnswerOutput = z.object({
  verdict: z.enum(["correct", "partially_correct", "incorrect"]),
  explanation: z.string(),
  evidence: verifiedEvidenceSchema,
  misconceptionLabel: z.string().optional(),
  conceptId: z.string().optional(),
  /** Verified quotation from student notes directly addressing the diagnosed misconception */
  recoveryCitation: verifiedEvidenceSchema.optional(),
});

// --- record_progress ---
export const recordProgressInput = z.object({
  questionId: z.string().min(1).max(80),
  answer: z.string().trim().min(1).max(2000),
  verdict: z.enum(["correct", "partially_correct", "incorrect"]),
  misconceptionLabel: z.string().max(80).optional(),
  /** If this attempt was specifically to recover a diagnosed misconception */
  recoveryForMisconceptionLabel: z.string().max(80).optional(),
  clientAttemptId: z.string().max(120).optional(),
});
export const recordProgressOutput = z.object({
  attemptId: z.string(),
  mastery: z.number().min(0).max(1),
  nextReviewAt: z.string().optional(),
  retestScheduled: z.boolean(),
  misconceptionResolved: z.boolean().optional(),
  resolvedMisconceptionLabel: z.string().optional(),
  recoveryStatus: z.enum(["open", "in_recovery", "resolved"]).optional(),
});

export const TOOL_NAMES = [
  "search_study_notes",
  "get_mastery",
  "generate_quiz",
  "evaluate_answer",
  "record_progress",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type SearchStudyNotesInput = z.infer<typeof searchStudyNotesInput>;
export type GetMasteryInput = z.infer<typeof getMasteryInput>;
export type GenerateQuizInput = z.infer<typeof generateQuizInput>;
export type EvaluateAnswerInput = z.infer<typeof evaluateAnswerInput>;
export type RecordProgressInput = z.infer<typeof recordProgressInput>;

export type SearchStudyNotesOutput = z.infer<typeof searchStudyNotesOutput>;
export type GetMasteryOutput = z.infer<typeof getMasteryOutput>;
export type GenerateQuizOutput = z.infer<typeof generateQuizOutput>;
export type EvaluateAnswerOutput = z.infer<typeof evaluateAnswerOutput>;
export type RecordProgressOutput = z.infer<typeof recordProgressOutput>;
