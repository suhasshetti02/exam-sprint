/**
 * Server-side Rapid-Fire Redemption challenge service.
 *
 * Architecture:
 * - Calls MCP tools over HTTP for quiz generation, evaluation, and progress persistence
 *   (reusing the existing executeMcpTool wrapper).
 * - Maintains challenge_runs / challenge_question_slots tables via direct SQLite access
 *   (the web server and MCP server share the same SQLite file).
 * - All scoring is server-authoritative. Client never computes or sends scores.
 */

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { executeMcpTool, type ToolTraceEntry } from "./mcp-client";
import {
  type EvaluateAnswerOutput,
  type GenerateQuizOutput,
  type GetMasteryOutput,
  type RecordProgressOutput,
} from "@exam-sprint/core";

// ---- DB helpers -----------------------------------------------------------

function findDatabasePath(): string | null {
  const envPath = process.env.DATABASE_PATH ?? "data/local/exam-sprint.db";
  const candidates = [
    resolve(/*turbopackIgnore: true*/ process.cwd(), envPath),
    resolve(/*turbopackIgnore: true*/ process.cwd(), "..", "..", envPath),
    resolve(/*turbopackIgnore: true*/ process.cwd(), "..", envPath),
    envPath,
  ];
  for (const c of candidates) {
    if (existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return null;
}

function openDb(): DatabaseSync | null {
  const dbPath = findDatabasePath();
  if (!dbPath) return null;
  return new DatabaseSync(dbPath);
}

export const CHALLENGE_SIZE = 5;
const DEFAULT_STUDENT_ID = "local-student";

export type ChallengeStatus = "active" | "completed" | "abandoned";
export type ChallengeVerdict = "correct" | "partially_correct" | "incorrect";

// ---- Internal DB types ----------------------------------------------------

interface RunRow {
  id: string;
  student_id: string;
  status: string;
  score: number;
  total_slots: number;
  started_at: string;
  completed_at: string | null;
}

interface SlotRow {
  id: string;
  challenge_id: string;
  slot_index: number;
  question_id: string;
  concept_id: string;
  answer_text: string | null;
  verdict: string | null;
  explanation: string | null;
  answered_at: string | null;
  attempt_id: string | null;
}

// ---- Public response types ------------------------------------------------

export interface ChallengeSlotPublic {
  slotIndex: number;
  questionId: string;
  conceptId: string;
  question: {
    prompt: string;
    kind: "multiple_choice" | "short_answer";
    choices?: string[];
    evidence: {
      chunkId: string;
      quote: string;
      status: "verified" | "unverified" | "rejected";
      start?: number;
      end?: number;
    };
  };
  answered: boolean;
  verdict?: ChallengeVerdict;
  explanation?: string;
}

export interface ChallengeStateResponse {
  challengeId: string;
  status: ChallengeStatus;
  score: number;
  totalSlots: number;
  startedAt: string;
  completedAt?: string;
  slots: ChallengeSlotPublic[];
  toolTraces: ToolTraceEntry[];
}

export interface AnswerSlotResponse {
  slotIndex: number;
  verdict: ChallengeVerdict;
  explanation: string;
  evidence: {
    chunkId: string;
    quote: string;
    status: "verified" | "unverified" | "rejected";
    start?: number;
    end?: number;
  };
  challenge: ChallengeStateResponse;
  toolTraces: ToolTraceEntry[];
}

export interface ChallengeRunSummary {
  id: string;
  status: string;
  score: number;
  totalSlots: number;
  startedAt: string;
  completedAt: string | null;
}

// ---- Concept priority ordering --------------------------------------------

const ALL_CONCEPT_IDS = [
  "normalization-basics",
  "functional-dependencies",
  "1nf",
  "2nf",
  "3nf",
  "bcnf",
  "acid",
  "isolation-levels",
] as const;

// ---- DB operations --------------------------------------------------------

function dbCreateRun(
  db: DatabaseSync,
  studentId: string,
  questions: Array<{ questionId: string; conceptId: string }>,
): string {
  const challengeId = `chal_${randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO challenge_runs (id, student_id, status, score, total_slots, started_at)
     VALUES (?, ?, 'active', 0, ?, ?)`,
  ).run(challengeId, studentId, CHALLENGE_SIZE, now);

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    db.prepare(
      `INSERT INTO challenge_question_slots
         (id, challenge_id, slot_index, question_id, concept_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(`slot_${randomUUID()}`, challengeId, i, q.questionId, q.conceptId);
  }

  return challengeId;
}

function dbGetRun(db: DatabaseSync, challengeId: string): { run: RunRow; slots: SlotRow[] } | null {
  const run = db
    .prepare(
      `SELECT id, student_id, status, score, total_slots, started_at, completed_at
       FROM challenge_runs WHERE id = ?`,
    )
    .get(challengeId) as RunRow | undefined;
  if (!run) return null;

  const slots = db
    .prepare(
      `SELECT id, challenge_id, slot_index, question_id, concept_id,
              answer_text, verdict, explanation, answered_at, attempt_id
       FROM challenge_question_slots WHERE challenge_id = ? ORDER BY slot_index`,
    )
    .all(challengeId) as unknown as SlotRow[];

  return { run, slots };
}

function dbRecordAnswer(
  db: DatabaseSync,
  challengeId: string,
  slotIndex: number,
  answer: string,
  verdict: ChallengeVerdict,
  explanation: string,
  attemptId: string,
): void {
  const slot = db
    .prepare(
      `SELECT id, answer_text FROM challenge_question_slots
       WHERE challenge_id = ? AND slot_index = ?`,
    )
    .get(challengeId, slotIndex) as { id: string; answer_text: string | null } | undefined;

  if (!slot) throw new Error(`Slot ${slotIndex} not found in challenge ${challengeId}`);
  if (slot.answer_text !== null) {
    throw new Error(`DUPLICATE: Slot ${slotIndex} in challenge ${challengeId} already answered`);
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE challenge_question_slots
     SET answer_text = ?, verdict = ?, explanation = ?, answered_at = ?, attempt_id = ?
     WHERE id = ?`,
  ).run(answer, verdict, explanation, now, attemptId, slot.id);
}

function dbCompleteRun(db: DatabaseSync, challengeId: string): void {
  const { cnt } = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM challenge_question_slots
       WHERE challenge_id = ? AND verdict = 'correct'`,
    )
    .get(challengeId) as { cnt: number };

  db.prepare(
    `UPDATE challenge_runs SET status = 'completed', score = ?, completed_at = ? WHERE id = ?`,
  ).run(cnt, new Date().toISOString(), challengeId);
}

// ---- Question selection ---------------------------------------------------

async function selectQuestions(
  toolTraces: ToolTraceEntry[],
): Promise<
  Array<{ questionId: string; conceptId: string; question: GenerateQuizOutput["questions"][0] }>
> {
  // Fetch mastery to determine which concepts are weak
  let masteryList: GetMasteryOutput["concepts"] = [];
  try {
    const r = await executeMcpTool<Record<string, never>, GetMasteryOutput>("get_mastery", {});
    masteryList = r.result.concepts;
    toolTraces.push(r.trace);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
  }

  // Priority order: open misconceptions → low mastery → the rest (shuffled)
  const withMisc = masteryList
    .filter((m) => m.openMisconceptions.length > 0)
    .map((m) => m.conceptId);

  const lowMastery = masteryList
    .filter((m) => !m.openMisconceptions.length && m.attemptsCount > 0 && m.mastery < 0.75)
    .sort((a, b) => a.mastery - b.mastery)
    .map((m) => m.conceptId);

  const restPool = ALL_CONCEPT_IDS.filter(
    (id) => !withMisc.includes(id) && !lowMastery.includes(id),
  ) as string[];

  // Fisher-Yates shuffle on the rest pool
  for (let i = restPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = restPool[i]!;
    restPool[i] = restPool[j]!;
    restPool[j] = tmp;
  }

  const priority = [...withMisc, ...lowMastery, ...restPool];

  const selected: Array<{
    questionId: string;
    conceptId: string;
    question: GenerateQuizOutput["questions"][0];
  }> = [];
  const usedQuestionIds = new Set<string>();
  const usedConcepts = new Set<string>();

  // First pass: one unique question per concept in priority order
  for (const conceptId of priority) {
    if (selected.length >= CHALLENGE_SIZE) break;
    if (usedConcepts.has(conceptId)) continue;

    try {
      const r = await executeMcpTool<
        { conceptId: string; count: number; focus: "new" | "weak" | "review" },
        GenerateQuizOutput
      >("generate_quiz", {
        conceptId,
        count: 3,
        focus: withMisc.includes(conceptId) ? "weak" : "new",
      });
      toolTraces.push(r.trace);

      for (const q of r.result.questions) {
        if (!usedQuestionIds.has(q.questionId)) {
          selected.push({ questionId: q.questionId, conceptId: q.conceptId, question: q });
          usedQuestionIds.add(q.questionId);
          usedConcepts.add(conceptId);
          break;
        }
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "trace" in err) {
        toolTraces.push((err as { trace: ToolTraceEntry }).trace);
      }
    }
  }

  // Second pass: fill remaining slots allowing concept repeats
  if (selected.length < CHALLENGE_SIZE) {
    for (const conceptId of ALL_CONCEPT_IDS) {
      if (selected.length >= CHALLENGE_SIZE) break;
      try {
        const r = await executeMcpTool<
          { conceptId: string; count: number; focus: "new" | "weak" | "review" },
          GenerateQuizOutput
        >("generate_quiz", { conceptId, count: 5, focus: "new" });
        for (const q of r.result.questions) {
          if (!usedQuestionIds.has(q.questionId) && selected.length < CHALLENGE_SIZE) {
            selected.push({ questionId: q.questionId, conceptId: q.conceptId, question: q });
            usedQuestionIds.add(q.questionId);
          }
        }
      } catch {
        // Skip unavailable concept
      }
    }
  }

  return selected;
}

// ---- Public service functions --------------------------------------------

/** Build public-safe slot from DB row + question cache. */
function buildPublicSlot(
  slot: SlotRow,
  questionCache: Map<string, GenerateQuizOutput["questions"][0]>,
): ChallengeSlotPublic {
  const q = questionCache.get(slot.question_id);
  return {
    slotIndex: slot.slot_index,
    questionId: slot.question_id,
    conceptId: slot.concept_id,
    question: q
      ? {
          prompt: q.prompt,
          kind: q.kind,
          choices: q.choices,
          evidence: q.evidence,
        }
      : {
          prompt: "Question data unavailable",
          kind: "short_answer" as const,
          evidence: { chunkId: "", quote: "", status: "unverified" as const },
        },
    answered: slot.answer_text !== null,
    verdict: slot.verdict as ChallengeVerdict | undefined,
    explanation: slot.explanation ?? undefined,
  };
}

/**
 * Start a new Rapid-Fire Redemption challenge.
 * Selects 5 questions biased toward weak concepts, persists the run in SQLite.
 */
export async function startChallenge(): Promise<ChallengeStateResponse> {
  const toolTraces: ToolTraceEntry[] = [];

  const selected = await selectQuestions(toolTraces);
  if (selected.length < CHALLENGE_SIZE) {
    throw new Error(
      `Not enough questions for a challenge (found ${selected.length}/${CHALLENGE_SIZE}). ` +
        `Ensure the MCP server is running and db:init has been executed.`,
    );
  }

  const db = openDb();
  if (!db) throw new Error("Database not initialised. Run npm run db:init first.");

  let challengeId: string;
  try {
    challengeId = dbCreateRun(
      db,
      DEFAULT_STUDENT_ID,
      selected.map((s) => ({ questionId: s.questionId, conceptId: s.conceptId })),
    );
  } finally {
    db.close();
  }

  const questionCache = new Map(selected.map((s) => [s.questionId, s.question]));

  const db2 = openDb()!;
  let data: { run: RunRow; slots: SlotRow[] };
  try {
    data = dbGetRun(db2, challengeId)!;
  } finally {
    db2.close();
  }

  return {
    challengeId: data.run.id,
    status: data.run.status as ChallengeStatus,
    score: data.run.score,
    totalSlots: data.run.total_slots,
    startedAt: data.run.started_at,
    completedAt: data.run.completed_at ?? undefined,
    slots: data.slots.map((s) => buildPublicSlot(s, questionCache)),
    toolTraces,
  };
}

/**
 * Submit an answer to a challenge slot.
 * - Server-side evaluation via MCP (trusted).
 * - Mastery persistence via MCP record_progress.
 * - Duplicate submission prevention in SQLite.
 * - Auto-completes and scores the run when all slots answered.
 */
export async function answerChallengeSlot(
  challengeId: string,
  slotIndex: number,
  answer: string,
): Promise<AnswerSlotResponse> {
  const toolTraces: ToolTraceEntry[] = [];

  // 1. Validate run + slot
  const db = openDb();
  if (!db) throw new Error("Database not initialised.");

  let questionId: string;
  try {
    const data = dbGetRun(db, challengeId);
    if (!data) throw new Error(`Challenge not found: ${challengeId}`);
    if (data.run.status !== "active") {
      throw new Error(`Challenge ${challengeId} is already ${data.run.status}`);
    }
    const slot = data.slots.find((s) => s.slot_index === slotIndex);
    if (!slot) throw new Error(`Invalid slot index ${slotIndex}`);
    if (slot.answer_text !== null) {
      throw new Error(`Slot ${slotIndex} is already answered`);
    }
    questionId = slot.question_id;
  } finally {
    db.close();
  }

  // 2. Evaluate with trusted MCP tool
  let evaluation: EvaluateAnswerOutput;
  try {
    const r = await executeMcpTool<{ questionId: string; answer: string }, EvaluateAnswerOutput>(
      "evaluate_answer",
      { questionId, answer },
    );
    evaluation = r.result;
    toolTraces.push(r.trace);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
    throw err;
  }

  // 3. Persist mastery via record_progress
  let attemptId = `chal-fallback-${Date.now()}`;
  try {
    const r = await executeMcpTool<
      {
        questionId: string;
        answer: string;
        verdict: "correct" | "partially_correct" | "incorrect";
        misconceptionLabel?: string;
      },
      RecordProgressOutput
    >("record_progress", {
      questionId,
      answer,
      verdict: evaluation.verdict,
      misconceptionLabel: evaluation.misconceptionLabel,
    });
    attemptId = r.result.attemptId;
    toolTraces.push(r.trace);
  } catch (err: unknown) {
    if (err && typeof err === "object" && "trace" in err) {
      toolTraces.push((err as { trace: ToolTraceEntry }).trace);
    }
    // Non-fatal: continue even if mastery persistence fails
    console.warn("[challenge-service] record_progress non-fatal error:", err);
  }

  // 4. Record answer in challenge slot (idempotency-guarded)
  const db3 = openDb();
  if (!db3) throw new Error("Database not initialised.");

  let finalRun: { run: RunRow; slots: SlotRow[] };
  try {
    dbRecordAnswer(
      db3,
      challengeId,
      slotIndex,
      answer,
      evaluation.verdict as ChallengeVerdict,
      evaluation.explanation,
      attemptId,
    );

    // 5. Auto-complete if all slots answered
    const updated = dbGetRun(db3, challengeId)!;
    const allAnswered = updated.slots.every((s) => s.answer_text !== null);
    if (allAnswered) {
      dbCompleteRun(db3, challengeId);
    }
    finalRun = dbGetRun(db3, challengeId)!;
  } finally {
    db3.close();
  }

  // 6. Fetch question prompts for the response (best-effort)
  const questionCache = new Map<string, GenerateQuizOutput["questions"][0]>();
  const conceptIds = [...new Set(finalRun.slots.map((s) => s.concept_id))];
  for (const cId of conceptIds) {
    try {
      const r = await executeMcpTool<
        { conceptId: string; count: number; focus: "new" | "weak" | "review" },
        GenerateQuizOutput
      >("generate_quiz", { conceptId: cId, count: 5, focus: "new" });
      for (const q of r.result.questions) {
        questionCache.set(q.questionId, q);
      }
    } catch {
      // Non-fatal
    }
  }

  const challengeState: ChallengeStateResponse = {
    challengeId: finalRun.run.id,
    status: finalRun.run.status as ChallengeStatus,
    score: finalRun.run.score,
    totalSlots: finalRun.run.total_slots,
    startedAt: finalRun.run.started_at,
    completedAt: finalRun.run.completed_at ?? undefined,
    slots: finalRun.slots.map((s) => buildPublicSlot(s, questionCache)),
    toolTraces,
  };

  return {
    slotIndex,
    verdict: evaluation.verdict as ChallengeVerdict,
    explanation: evaluation.explanation,
    evidence: evaluation.evidence,
    challenge: challengeState,
    toolTraces,
  };
}

/** Load a challenge by ID for state polling. */
export async function loadChallenge(challengeId: string): Promise<ChallengeStateResponse> {
  const db = openDb();
  if (!db) throw new Error("Database not initialised.");

  let data: { run: RunRow; slots: SlotRow[] };
  try {
    const found = dbGetRun(db, challengeId);
    if (!found) throw new Error(`Challenge not found: ${challengeId}`);
    data = found;
  } finally {
    db.close();
  }

  const toolTraces: ToolTraceEntry[] = [];
  const questionCache = new Map<string, GenerateQuizOutput["questions"][0]>();
  const conceptIds = [...new Set(data.slots.map((s) => s.concept_id))];

  for (const cId of conceptIds) {
    try {
      const r = await executeMcpTool<
        { conceptId: string; count: number; focus: "new" | "weak" | "review" },
        GenerateQuizOutput
      >("generate_quiz", { conceptId: cId, count: 5, focus: "new" });
      for (const q of r.result.questions) {
        questionCache.set(q.questionId, q);
      }
    } catch {
      // Non-fatal
    }
  }

  return {
    challengeId: data.run.id,
    status: data.run.status as ChallengeStatus,
    score: data.run.score,
    totalSlots: data.run.total_slots,
    startedAt: data.run.started_at,
    completedAt: data.run.completed_at ?? undefined,
    slots: data.slots.map((s) => buildPublicSlot(s, questionCache)),
    toolTraces,
  };
}

/** Return last 5 completed challenge runs for the student (lightweight). */
export function listRecentChallenges(): ChallengeRunSummary[] {
  const db = openDb();
  if (!db) return [];
  try {
    return (
      db
        .prepare(
          `SELECT id, status, score, total_slots, started_at, completed_at
           FROM challenge_runs WHERE student_id = ?
           ORDER BY started_at DESC LIMIT 5`,
        )
        .all(DEFAULT_STUDENT_ID) as unknown as RunRow[]
    ).map((r) => ({
      id: r.id,
      status: r.status,
      score: r.score,
      totalSlots: r.total_slots,
      startedAt: r.started_at,
      completedAt: r.completed_at,
    }));
  } finally {
    db.close();
  }
}
