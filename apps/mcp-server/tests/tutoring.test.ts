import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DefaultEvidenceVerifier,
  DeterministicAnswerEvaluator,
  filterQuestions,
} from "@exam-sprint/core";
import {
  applyMigrations,
  seedConcepts,
  seedNotes,
  seedQuestions,
} from "../../../scripts/db-init.mjs";
import {
  getQuestionById,
  loadChunks,
  loadQuestions,
  SqliteProgressStore,
} from "../src/db";

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const testDbPath = join(monorepoRoot, "data", "local", "test-tutoring.db");

describe("Deterministic Tutoring Engine & Persistence (Milestone 2)", () => {
  let db: DatabaseSync;
  let verifier: DefaultEvidenceVerifier;
  let evaluator: DeterministicAnswerEvaluator;

  beforeAll(() => {
    if (!existsSync(dirname(testDbPath))) {
      mkdirSync(dirname(testDbPath), { recursive: true });
    }
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore
    }
    db = new DatabaseSync(testDbPath);
    applyMigrations(db);
    seedConcepts(db);
    seedNotes(db);
    seedQuestions(db);

    verifier = new DefaultEvidenceVerifier();
    evaluator = new DeterministicAnswerEvaluator(verifier);
  });

  afterAll(() => {
    db.close();
    try {
      unlinkSync(testDbPath);
    } catch {
      // ignore
    }
  });

  describe("Question generation and verified citations", () => {
    it("loads seeded questions for a concept and verifies evidence against source chunks", () => {
      const questions = loadQuestions(db, "2nf");
      expect(questions.length).toBeGreaterThanOrEqual(2);

      const chunks = loadChunks(db);
      const chunkMap = new Map(chunks.map((c) => [c.id, c]));

      for (const q of questions) {
        expect(q.conceptId).toBe("2nf");
        expect(q.prompt).toBeTruthy();
        expect(q.evidenceChunkId).toBeTruthy();
        expect(q.evidenceQuote).toBeTruthy();

        // Verify quote physically exists in cited chunk
        const chunk = chunkMap.get(q.evidenceChunkId);
        expect(chunk).toBeDefined();

        const verified = verifier.verify(
          { chunkId: q.evidenceChunkId, quote: q.evidenceQuote },
          chunk,
        );
        expect(verified.status).toBe("verified");
        expect(verified.reference.start).toBeDefined();
        expect(verified.reference.end).toBeDefined();
        expect(verified.reference.start).toBeLessThan(verified.reference.end!);
      }
    });

    it("filters questions based on focus and unattempted status", () => {
      const questions = loadQuestions(db, "2nf");
      const attempted = new Set([questions[0]!.id]);

      const filteredNew = filterQuestions(questions, "2nf", {
        focus: "new",
        count: 1,
        attemptedQuestionIds: attempted,
      });

      expect(filteredNew.length).toBe(1);
      expect(filteredNew[0]!.id).toBe(questions[1]!.id); // picks unattempted question
    });
  });

  describe("Deterministic answer evaluation", () => {
    it("evaluates a correct answer without updating mastery", () => {
      const q = getQuestionById(db, "q-2nf-1")!;
      const chunks = loadChunks(db);
      const chunk = chunks.find((c) => c.id === q.evidenceChunkId);

      const result = evaluator.evaluate(q, "partial dependencies", chunk);
      expect(result.verdict).toBe("correct");
      expect(result.evidence.status).toBe("verified");
      expect(result.misconceptionLabel).toBeUndefined();

      // Verify no attempts were recorded
      const attemptsCount = db.prepare("SELECT COUNT(*) as n FROM attempts").get() as { n: number };
      expect(attemptsCount.n).toBe(0);
    });

    it("evaluates a partially correct answer", () => {
      const q = getQuestionById(db, "q-2nf-1")!;
      const chunks = loadChunks(db);
      const chunk = chunks.find((c) => c.id === q.evidenceChunkId);

      const result = evaluator.evaluate(q, "dependencies on composite key", chunk);
      expect(result.verdict).toBe("partially_correct");
      expect(result.explanation).toContain("Partially correct");
      expect(result.evidence.status).toBe("verified");
    });

    it("evaluates an incorrect answer with a diagnosed misconception", () => {
      const q = getQuestionById(db, "q-2nf-1")!;
      const chunks = loadChunks(db);
      const chunk = chunks.find((c) => c.id === q.evidenceChunkId);

      const result = evaluator.evaluate(q, "it removes transitive dependencies", chunk);
      expect(result.verdict).toBe("incorrect");
      expect(result.misconceptionLabel).toBe("confuses-2nf-with-3nf");
      expect(result.explanation).toContain("Transitive dependencies are removed by 3NF");
      expect(result.evidence.status).toBe("verified");
    });

    it("handles invalid question IDs safely in getQuestionById", () => {
      const invalid = getQuestionById(db, "non-existent-question-id");
      expect(invalid).toBeNull();
    });
  });

  describe("Learning history, mastery deltas, and retesting", () => {
    const studentId = "test-learner-1";

    it("records an incorrect attempt, penalizes mastery, tracks misconception, and schedules retest", async () => {
      const store = new SqliteProgressStore(db);

      const update = await store.recordAttempt({
        studentId,
        questionId: "q-2nf-1",
        answer: "transitive dependencies",
        verdict: "incorrect",
        misconceptionLabel: "confuses-2nf-with-3nf",
      });

      expect(update.attemptId).toBeTruthy();
      expect(update.mastery.mastery).toBe(0.0); // 0 - 0.20 clamped at 0
      expect(update.mastery.attemptsCount).toBe(1);
      expect(update.misconception).toBeDefined();
      expect(update.misconception?.label).toBe("confuses-2nf-with-3nf");
      expect(update.retestScheduled).toBe(true);

      // Verify learner is now identified as weak on 2nf
      const openMisc = store.getOpenMisconceptions(studentId, "2nf");
      expect(openMisc).toContain("confuses-2nf-with-3nf");

      const masteryList = await store.getMastery(studentId, ["2nf"]);
      expect(masteryList[0]?.mastery).toBe(0.0);
      expect(masteryList[0]?.attemptsCount).toBe(1);
    });

    it("adaptive question selection prioritizes weak concepts with open misconceptions", async () => {
      const store = new SqliteProgressStore(db);
      const openMisc = new Set(store.getOpenMisconceptions(studentId, "2nf"));
      const attempted = store.getAttemptedQuestionIds(studentId, "2nf");
      const questions = loadQuestions(db, "2nf");

      const weakQuestions = filterQuestions(questions, "2nf", {
        focus: "weak",
        count: 1,
        attemptedQuestionIds: attempted,
        openMisconceptionLabels: openMisc,
      });

      expect(weakQuestions.length).toBe(1);
      // Selected question should target the open misconception
      const hasTargetedMisc = weakQuestions[0]?.expected.misconceptions?.some(
        (m) => m.label === "confuses-2nf-with-3nf",
      );
      expect(hasTargetedMisc).toBe(true);
    });

    it("records a subsequent correct answer, increases mastery, and resolves open misconception", async () => {
      const store = new SqliteProgressStore(db);

      const update = await store.recordAttempt({
        studentId,
        questionId: "q-2nf-2",
        answer: "A",
        verdict: "correct",
      });

      expect(update.mastery.mastery).toBe(0.25); // 0 + 0.25
      expect(update.mastery.attemptsCount).toBe(2);

      // Open misconception should now be resolved
      const openMisc = store.getOpenMisconceptions(studentId, "2nf");
      expect(openMisc).not.toContain("confuses-2nf-with-3nf");

      // Retest should be completed
      const retests = db
        .prepare("SELECT status FROM retests WHERE student_id = ?")
        .all(studentId) as Array<{ status: string }>;
      expect(retests.every((r) => r.status === "completed")).toBe(true);
    });

    it("records another correct answer and further increases mastery to 0.50", async () => {
      const store = new SqliteProgressStore(db);

      const update = await store.recordAttempt({
        studentId,
        questionId: "q-2nf-1",
        answer: "partial dependencies",
        verdict: "correct",
      });

      expect(update.mastery.mastery).toBe(0.5); // 0.25 + 0.25
      expect(update.mastery.attemptsCount).toBe(3);
    });

    it("rejects attempt recording for invalid question ID", async () => {
      const store = new SqliteProgressStore(db);
      await expect(
        store.recordAttempt({
          studentId,
          questionId: "invalid-q",
          answer: "x",
          verdict: "correct",
        }),
      ).rejects.toThrow(/Question not found/);
    });
  });

  describe("Persistence across database reopen / server restart", () => {
    it("preserves attempts, mastery, and misconceptions after reopening the database", async () => {
      // Close current db connection
      db.close();

      // Open new connection to the exact same file
      const reopenedDb = new DatabaseSync(testDbPath);
      const store = new SqliteProgressStore(reopenedDb);

      const studentId = "test-learner-1";
      const masteryList = await store.getMastery(studentId, ["2nf"]);
      expect(masteryList[0]?.mastery).toBe(0.5);
      expect(masteryList[0]?.attemptsCount).toBe(3);

      const attempts = reopenedDb
        .prepare("SELECT COUNT(*) as n FROM attempts WHERE student_id = ?")
        .get(studentId) as { n: number };
      expect(attempts.n).toBe(3);

      reopenedDb.close();

      // Re-assign for afterAll hook cleanup
      db = new DatabaseSync(testDbPath);
    });

    it("verifies mastery scoring bounds [0.0, 1.0] and attempts aggregation integrity", async () => {
      const store = new SqliteProgressStore(db);
      const studentId = "test-learner-bounds";

      // Test lower bound clamping at 0.0 with multiple incorrect attempts
      for (let i = 0; i < 5; i++) {
        await store.recordAttempt({
          studentId,
          questionId: "q-bcnf-1",
          answer: "don't know",
          verdict: "incorrect",
        });
      }

      const masteryListLow = await store.getMastery(studentId, ["bcnf"]);
      expect(masteryListLow[0]?.mastery).toBe(0.0);
      expect(masteryListLow[0]?.attemptsCount).toBe(5);

      // Verify attempts table count matches attemptsCount exactly
      const countRow = db
        .prepare("SELECT COUNT(*) as n FROM attempts WHERE student_id = ? AND question_id = 'q-bcnf-1'")
        .get(studentId) as { n: number };
      expect(countRow.n).toBe(5);

      // Test upper bound clamping at 1.0 with multiple correct attempts
      for (let i = 0; i < 6; i++) {
        await store.recordAttempt({
          studentId,
          questionId: "q-bcnf-2",
          answer: "A",
          verdict: "correct",
        });
      }

      const masteryListHigh = await store.getMastery(studentId, ["bcnf"]);
      expect(masteryListHigh[0]?.mastery).toBe(1.0);
      expect(masteryListHigh[0]?.attemptsCount).toBe(11);

      // Ensure no open misconceptions were created by "don't know" attempts
      const openMiscs = store.getOpenMisconceptions(studentId, "bcnf");
      expect(openMiscs.length).toBe(0);
    });
  });
});
