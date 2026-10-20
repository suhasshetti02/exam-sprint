/**
 * SQLite challenge run repository for Rapid-Fire Redemption.
 * Server-only: uses node:sqlite.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ToolError } from "../errors";

export const CHALLENGE_SIZE = 5;

export type ChallengeStatus = "active" | "completed" | "abandoned";
export type ChallengeVerdict = "correct" | "partially_correct" | "incorrect";

export interface ChallengeSlot {
  id: string;
  challengeId: string;
  slotIndex: number;
  questionId: string;
  conceptId: string;
  answerText: string | null;
  verdict: ChallengeVerdict | null;
  explanation: string | null;
  answeredAt: string | null;
  attemptId: string | null;
}

export interface ChallengeRun {
  id: string;
  studentId: string;
  status: ChallengeStatus;
  score: number;
  totalSlots: number;
  startedAt: string;
  completedAt: string | null;
  slots: ChallengeSlot[];
}

export interface ChallengeRunSummary {
  id: string;
  status: string;
  score: number;
  totalSlots: number;
  startedAt: string;
  completedAt: string | null;
}

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

function mapSlot(r: SlotRow): ChallengeSlot {
  return {
    id: r.id,
    challengeId: r.challenge_id,
    slotIndex: r.slot_index,
    questionId: r.question_id,
    conceptId: r.concept_id,
    answerText: r.answer_text,
    verdict: r.verdict as ChallengeVerdict | null,
    explanation: r.explanation,
    answeredAt: r.answered_at,
    attemptId: r.attempt_id,
  };
}

function mapRun(r: RunRow, slots: SlotRow[]): ChallengeRun {
  return {
    id: r.id,
    studentId: r.student_id,
    status: r.status as ChallengeStatus,
    score: r.score,
    totalSlots: r.total_slots,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    slots: slots.map(mapSlot),
  };
}

/** Create a new challenge run and seed its question slots. */
export function createChallengeRun(
  db: DatabaseSync,
  studentId: string,
  questions: Array<{ questionId: string; conceptId: string }>,
): ChallengeRun {
  if (questions.length !== CHALLENGE_SIZE) {
    throw new ToolError(
      "invalid_state",
      `Challenge requires exactly ${CHALLENGE_SIZE} questions`,
    );
  }

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

  return getChallengeRun(db, challengeId)!;
}

/** Load a challenge run with all its slots, or return null if not found. */
export function getChallengeRun(db: DatabaseSync, challengeId: string): ChallengeRun | null {
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

  return mapRun(run, slots);
}

/**
 * Record an answer to a challenge slot.
 * Throws "conflict" if the slot is already answered (idempotency guard against double submission).
 */
export function recordChallengeAnswer(
  db: DatabaseSync,
  challengeId: string,
  slotIndex: number,
  answer: string,
  verdict: ChallengeVerdict,
  explanation: string,
  attemptId: string,
): ChallengeSlot {
  const slot = db
    .prepare(
      `SELECT id, answer_text FROM challenge_question_slots
       WHERE challenge_id = ? AND slot_index = ?`,
    )
    .get(challengeId, slotIndex) as { id: string; answer_text: string | null } | undefined;

  if (!slot) {
    throw new ToolError("not_found", `Slot ${slotIndex} not found in challenge ${challengeId}`);
  }
  if (slot.answer_text !== null) {
    throw new ToolError(
      "invalid_state",
      `Slot ${slotIndex} in challenge ${challengeId} is already answered`,
    );
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE challenge_question_slots
     SET answer_text = ?, verdict = ?, explanation = ?, answered_at = ?, attempt_id = ?
     WHERE id = ?`,
  ).run(answer, verdict, explanation, now, attemptId, slot.id);

  const updated = db
    .prepare(
      `SELECT id, challenge_id, slot_index, question_id, concept_id,
              answer_text, verdict, explanation, answered_at, attempt_id
       FROM challenge_question_slots WHERE id = ?`,
    )
    .get(slot.id) as unknown as SlotRow;

  return mapSlot(updated);
}

/** Mark a challenge run as completed, compute final score from answered slots. */
export function completeChallengeRun(db: DatabaseSync, challengeId: string): ChallengeRun {
  const result = db
    .prepare(
      `SELECT COUNT(*) as cnt FROM challenge_question_slots
       WHERE challenge_id = ? AND verdict = 'correct'`,
    )
    .get(challengeId) as { cnt: number };

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE challenge_runs SET status = 'completed', score = ?, completed_at = ? WHERE id = ?`,
  ).run(result.cnt, now, challengeId);

  return getChallengeRun(db, challengeId)!;
}

/** List the most recent N challenge runs for a student (lightweight — no slots). */
export function listChallengeRuns(
  db: DatabaseSync,
  studentId: string,
  limit = 10,
): ChallengeRunSummary[] {
  const rows = db
    .prepare(
      `SELECT id, student_id, status, score, total_slots, started_at, completed_at
       FROM challenge_runs WHERE student_id = ?
       ORDER BY started_at DESC LIMIT ?`,
    )
    .all(studentId, limit) as unknown as RunRow[];

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    score: r.score,
    totalSlots: r.total_slots,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }));
}
