/**
 * SQLite progress and learning history repository.
 * Server-only: uses node:sqlite.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  calculateMastery,
  calculateNextReview,
  type ConceptMastery,
  type Misconception,
  type ProgressStore,
  type ProgressUpdate,
  type Verdict,
} from "@exam-sprint/core";
import { getQuestionById } from "./questions";
import { ToolError } from "../errors";

interface MasteryRow {
  student_id: string;
  concept_id: string;
  mastery: number;
  attempts_count: number;
  last_attempt_at: string | null;
  next_review_at: string | null;
}

interface MisconceptionRow {
  id: string;
  student_id: string;
  concept_id: string;
  label: string;
  description: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
}

export class SqliteProgressStore implements ProgressStore {
  constructor(private db: DatabaseSync) {}

  public ensureStudent(studentId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO students (id) VALUES (?)").run(studentId);
  }

  public async getMastery(
    studentId: string,
    conceptIds?: string[],
    documentId?: string,
  ): Promise<ConceptMastery[]> {
    this.ensureStudent(studentId);

    // If specific conceptIds were passed, query those; otherwise query concepts from the catalogue
    let targetConceptIds = conceptIds;
    if (!targetConceptIds || targetConceptIds.length === 0) {
      let allConcepts: Array<{ id: string }>;
      if (documentId) {
        allConcepts = this.db
          .prepare("SELECT id FROM concepts WHERE document_id = ? ORDER BY id")
          .all(documentId) as unknown as Array<{ id: string }>;
      } else {
        allConcepts = this.db
          .prepare("SELECT id FROM concepts ORDER BY id")
          .all() as unknown as Array<{ id: string }>;
      }
      targetConceptIds = allConcepts.map((c) => c.id);
    }

    const results: ConceptMastery[] = [];
    const getMasteryStmt = this.db.prepare(
      "SELECT student_id, concept_id, mastery, attempts_count, last_attempt_at, next_review_at FROM concept_mastery WHERE student_id = ? AND concept_id = ?",
    );

    for (const cId of targetConceptIds) {
      const row = getMasteryStmt.get(studentId, cId) as unknown as MasteryRow | undefined;
      if (row) {
        results.push({
          studentId: row.student_id,
          conceptId: row.concept_id,
          mastery: row.mastery,
          attemptsCount: row.attempts_count,
          lastAttemptAt: row.last_attempt_at ?? undefined,
          nextReviewAt: row.next_review_at ?? undefined,
        });
      } else {
        // Concept has not been attempted yet: default mastery 0
        results.push({
          studentId,
          conceptId: cId,
          mastery: 0,
          attemptsCount: 0,
        });
      }
    }

    return results;
  }

  public getOpenMisconceptions(studentId: string, conceptId?: string): string[] {
    let rows: Array<{ label: string }>;
    if (conceptId) {
      rows = this.db
        .prepare(
          "SELECT label FROM misconceptions WHERE student_id = ? AND concept_id = ? AND resolved_at IS NULL ORDER BY last_seen_at DESC",
        )
        .all(studentId, conceptId) as unknown as Array<{ label: string }>;
    } else {
      rows = this.db
        .prepare(
          "SELECT label FROM misconceptions WHERE student_id = ? AND resolved_at IS NULL ORDER BY last_seen_at DESC",
        )
        .all(studentId) as unknown as Array<{ label: string }>;
    }
    return rows.map((r) => r.label);
  }

  public getAttemptedQuestionIds(studentId: string, conceptId?: string): Set<string> {
    let rows: Array<{ question_id: string }>;
    if (conceptId) {
      rows = this.db
        .prepare(
          "SELECT DISTINCT a.question_id FROM attempts a JOIN questions q ON a.question_id = q.id WHERE a.student_id = ? AND q.concept_id = ?",
        )
        .all(studentId, conceptId) as unknown as Array<{ question_id: string }>;
    } else {
      rows = this.db
        .prepare("SELECT DISTINCT question_id FROM attempts WHERE student_id = ?")
        .all(studentId) as unknown as Array<{ question_id: string }>;
    }
    return new Set(rows.map((r) => r.question_id));
  }

  public async recordAttempt(input: {
    studentId: string;
    questionId: string;
    answer: string;
    verdict: Verdict;
    misconceptionLabel?: string;
    recoveryForMisconceptionLabel?: string;
    clientAttemptId?: string;
  }): Promise<ProgressUpdate> {
    this.ensureStudent(input.studentId);

    const question = getQuestionById(this.db, input.questionId);
    if (!question) {
      throw new ToolError("not_found", `Question not found: ${input.questionId}`);
    }

    // Server-enforced idempotency: if clientAttemptId is provided and already recorded, return existing state
    if (input.clientAttemptId) {
      const existing = this.db
        .prepare(
          "SELECT id, verdict, created_at FROM attempts WHERE student_id = ? AND client_attempt_id = ?",
        )
        .get(input.studentId, input.clientAttemptId) as unknown as
        | { id: string; verdict: Verdict; created_at: string }
        | undefined;

      if (existing) {
        const currentMasteryRow = this.db
          .prepare(
            "SELECT student_id, concept_id, mastery, attempts_count, last_attempt_at, next_review_at FROM concept_mastery WHERE student_id = ? AND concept_id = ?",
          )
          .get(input.studentId, question.conceptId) as unknown as MasteryRow | undefined;

        return {
          attemptId: existing.id,
          mastery: {
            studentId: input.studentId,
            conceptId: question.conceptId,
            mastery: currentMasteryRow ? currentMasteryRow.mastery : 0,
            attemptsCount: currentMasteryRow ? currentMasteryRow.attempts_count : 1,
            lastAttemptAt: currentMasteryRow?.last_attempt_at ?? existing.created_at,
            nextReviewAt: currentMasteryRow?.next_review_at ?? undefined,
          },
          retestScheduled: false,
          misconceptionResolved: false,
        };
      }
    }

    const now = new Date().toISOString();
    const attemptId = `att_${randomUUID()}`;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      // 1. Insert attempt record with optional client_attempt_id
      this.db
        .prepare(
          `INSERT INTO attempts (
            id, student_id, question_id, answer_text, verdict,
            evidence_chunk_id, evidence_quote, created_at, client_attempt_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attemptId,
          input.studentId,
          input.questionId,
          input.answer,
          input.verdict,
          question.evidenceChunkId,
          question.evidenceQuote,
          now,
          input.clientAttemptId ?? null,
        );

      // 2. Read existing concept mastery
      const currentMasteryRow = this.db
        .prepare(
          "SELECT student_id, concept_id, mastery, attempts_count FROM concept_mastery WHERE student_id = ? AND concept_id = ?",
        )
        .get(input.studentId, question.conceptId) as unknown as MasteryRow | undefined;

      const currentMastery = currentMasteryRow ? currentMasteryRow.mastery : 0;
      const currentAttempts = currentMasteryRow ? currentMasteryRow.attempts_count : 0;

      const newMastery = calculateMastery(currentMastery, input.verdict);
      const nextReviewAt = calculateNextReview(newMastery);

      // 3. Upsert concept mastery
      this.db
        .prepare(
          `INSERT INTO concept_mastery (
            student_id, concept_id, mastery, attempts_count, last_attempt_at, next_review_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(student_id, concept_id) DO UPDATE SET
            mastery = excluded.mastery,
            attempts_count = excluded.attempts_count,
            last_attempt_at = excluded.last_attempt_at,
            next_review_at = excluded.next_review_at`,
        )
        .run(
          input.studentId,
          question.conceptId,
          newMastery,
          currentAttempts + 1,
          now,
          nextReviewAt,
        );

    // 4. Handle misconceptions and retest scheduling
    let retestScheduled = false;
    let recordedMisconception: Misconception | undefined;
    let misconceptionResolved = false;
    let resolvedMisconceptionLabel: string | undefined;
    let recoveryStatus: "open" | "in_recovery" | "resolved" | undefined;

    if (input.verdict === "incorrect" && input.misconceptionLabel) {
      const existing = this.db
        .prepare(
          "SELECT id, first_seen_at FROM misconceptions WHERE student_id = ? AND concept_id = ? AND label = ?",
        )
        .get(input.studentId, question.conceptId, input.misconceptionLabel) as unknown as
        | MisconceptionRow
        | undefined;

      let miscId: string;
      if (existing) {
        miscId = existing.id;
        this.db
          .prepare(
            "UPDATE misconceptions SET last_seen_at = ?, resolved_at = NULL, source_attempt_id = ? WHERE id = ?",
          )
          .run(now, attemptId, miscId);
        recordedMisconception = {
          id: miscId,
          studentId: input.studentId,
          conceptId: question.conceptId,
          label: input.misconceptionLabel,
          description: input.misconceptionLabel,
          firstSeenAt: existing.first_seen_at,
          lastSeenAt: now,
          status: "in_recovery",
        };
      } else {
        miscId = `misc_${randomUUID()}`;
        this.db
          .prepare(
            `INSERT INTO misconceptions (
              id, student_id, concept_id, label, description,
              first_seen_at, last_seen_at, source_attempt_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            miscId,
            input.studentId,
            question.conceptId,
            input.misconceptionLabel,
            input.misconceptionLabel,
            now,
            now,
            attemptId,
          );
        recordedMisconception = {
          id: miscId,
          studentId: input.studentId,
          conceptId: question.conceptId,
          label: input.misconceptionLabel,
          description: input.misconceptionLabel,
          firstSeenAt: now,
          lastSeenAt: now,
          status: "open",
        };
      }
      recoveryStatus = input.recoveryForMisconceptionLabel || existing ? "in_recovery" : "open";

      // Check if pending retest exists
      const pendingRetest = this.db
        .prepare(
          "SELECT id FROM retests WHERE student_id = ? AND misconception_id = ? AND status = 'pending'",
        )
        .get(input.studentId, miscId);

      if (!pendingRetest) {
        const retestId = `ret_${randomUUID()}`;
        this.db
          .prepare(
            "INSERT INTO retests (id, student_id, misconception_id, due_at, status) VALUES (?, ?, ?, ?, 'pending')",
          )
          .run(retestId, input.studentId, miscId, nextReviewAt);
        retestScheduled = true;
      }
    } else if (input.verdict === "correct") {
      // If recoveryForMisconceptionLabel is provided, resolve specifically that targeted misconception.
      // Otherwise, resolve open misconceptions for this concept if this question directly validates the concept.
      const targetLabel = input.recoveryForMisconceptionLabel;
      let openMiscs: Array<{ id: string; label: string }>;

      if (targetLabel) {
        openMiscs = this.db
          .prepare(
            "SELECT id, label FROM misconceptions WHERE student_id = ? AND concept_id = ? AND label = ? AND resolved_at IS NULL",
          )
          .all(input.studentId, question.conceptId, targetLabel) as unknown as Array<{ id: string; label: string }>;
      } else {
        openMiscs = this.db
          .prepare(
            "SELECT id, label FROM misconceptions WHERE student_id = ? AND concept_id = ? AND resolved_at IS NULL",
          )
          .all(input.studentId, question.conceptId) as unknown as Array<{ id: string; label: string }>;
      }

      for (const misc of openMiscs) {
        this.db
          .prepare("UPDATE misconceptions SET resolved_at = ? WHERE id = ?")
          .run(now, misc.id);
        this.db
          .prepare(
            "UPDATE retests SET status = 'completed', completed_attempt_id = ? WHERE misconception_id = ? AND status = 'pending'",
          )
          .run(attemptId, misc.id);
        misconceptionResolved = true;
        resolvedMisconceptionLabel = misc.label;
        recoveryStatus = "resolved";
      }
    }

    this.db.exec("COMMIT");

    return {
      attemptId,
      mastery: {
        studentId: input.studentId,
        conceptId: question.conceptId,
        mastery: newMastery,
        attemptsCount: currentAttempts + 1,
        lastAttemptAt: now,
        nextReviewAt,
      },
      misconception: recordedMisconception,
      retestScheduled,
      misconceptionResolved,
      resolvedMisconceptionLabel,
      recoveryStatus,
    };
  } catch (err: unknown) {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // ignore rollback error if transaction already terminated
    }

    if (
      input.clientAttemptId &&
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed")
    ) {
      // Concurrently recorded identical submission
      const existing = this.db
        .prepare(
          "SELECT id, verdict, created_at FROM attempts WHERE student_id = ? AND client_attempt_id = ?",
        )
        .get(input.studentId, input.clientAttemptId) as unknown as
        | { id: string; verdict: Verdict; created_at: string }
        | undefined;

      if (existing) {
        const currentMasteryRow = this.db
          .prepare(
            "SELECT student_id, concept_id, mastery, attempts_count, last_attempt_at, next_review_at FROM concept_mastery WHERE student_id = ? AND concept_id = ?",
          )
          .get(input.studentId, question.conceptId) as unknown as MasteryRow | undefined;

        return {
          attemptId: existing.id,
          mastery: {
            studentId: input.studentId,
            conceptId: question.conceptId,
            mastery: currentMasteryRow ? currentMasteryRow.mastery : 0,
            attemptsCount: currentMasteryRow ? currentMasteryRow.attempts_count : 1,
            lastAttemptAt: currentMasteryRow?.last_attempt_at ?? existing.created_at,
            nextReviewAt: currentMasteryRow?.next_review_at ?? undefined,
          },
          retestScheduled: false,
          misconceptionResolved: false,
        };
      }
    }

    throw err;
  }
}
}
