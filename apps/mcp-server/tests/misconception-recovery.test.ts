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
const testDbPath = join(monorepoRoot, "data", "local", "test-recovery-loop.db");

describe("Misconception-Recovery Learning Loop Regression Suite", () => {
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

  const studentId = "student-recovery-tester";

  it("1. Incorrect answer triggers diagnosed misconception with a verified note citation", () => {
    const q = getQuestionById(db, "q-2nf-1")!;
    expect(q).toBeDefined();

    const chunks = loadChunks(db);
    const chunk = chunks.find((c) => c.id === q.evidenceChunkId);
    expect(chunk).toBeDefined();

    // Answer with a known misconception pattern ("transitive dependencies")
    const result = evaluator.evaluate(q, "it eliminates transitive dependencies", chunk);
    expect(result.verdict).toBe("incorrect");
    expect(result.misconceptionLabel).toBe("confuses-2nf-with-3nf");
    expect(result.evidence.status).toBe("verified");
    expect(result.evidence.quote).toBe(q.evidenceQuote);
    expect(result.evidence.chunkId).toBe(q.evidenceChunkId);
  });

  it("2. Missing evidence does not fabricate citations", () => {
    const q = getQuestionById(db, "q-2nf-1")!;
    // Fabricated chunk that does NOT contain the quote
    const corruptChunk = {
      id: q.evidenceChunkId,
      documentId: "dbms-normalization",
      heading: "Altered chunk",
      ordinal: 1,
      text: "This chunk has completely different content and no mention of partial dependencies.",
    };

    const result = evaluator.evaluate(q, "it eliminates transitive dependencies", corruptChunk);
    expect(result.verdict).toBe("incorrect");
    expect(result.evidence.status).toBe("rejected");
    // Does not produce valid start/end offsets for rejected text
    expect(result.evidence.start).toBeUndefined();
    expect(result.evidence.end).toBeUndefined();
  });

  it("3. Targeted recovery question specifically targets the diagnosed misconception", () => {
    const questions = loadQuestions(db, "2nf");
    expect(questions.length).toBeGreaterThanOrEqual(2);

    // Filter questions targeting specifically "confuses-2nf-with-3nf" after q-2nf-1 was attempted
    const recoveryQuestions = filterQuestions(questions, "2nf", {
      targetedMisconceptionLabel: "confuses-2nf-with-3nf",
      attemptedQuestionIds: new Set(["q-2nf-1"]),
      focus: "weak",
      count: 1,
    });

    expect(recoveryQuestions.length).toBe(1);
    const selected = recoveryQuestions[0]!;
    const targetsMisconception = selected.expected.misconceptions?.some(
      (m) => m.label === "confuses-2nf-with-3nf",
    );
    expect(targetsMisconception).toBe(true);
    // Picks the unattempted question q-2nf-2 that targets this misconception
    expect(selected.id).toBe("q-2nf-2");
  });

  it("4. Incorrect recovery attempt retains in_recovery / open status and does not resolve misconception", async () => {
    const store = new SqliteProgressStore(db);

    // Initial incorrect attempt creating open misconception
    const firstAttempt = await store.recordAttempt({
      studentId,
      questionId: "q-2nf-1",
      answer: "transitive dependencies",
      verdict: "incorrect",
      misconceptionLabel: "confuses-2nf-with-3nf",
    });

    expect(firstAttempt.mastery.mastery).toBe(0.0);
    expect(firstAttempt.misconception?.status).toBe("open");
    expect(firstAttempt.recoveryStatus).toBe("open");

    // Student attempts recovery question but answers incorrectly (picks distractor B)
    const recoveryFail = await store.recordAttempt({
      studentId,
      questionId: "q-2nf-2",
      answer: "B",
      verdict: "incorrect",
      misconceptionLabel: "confuses-2nf-with-bcnf",
      recoveryForMisconceptionLabel: "confuses-2nf-with-3nf",
    });

    expect(recoveryFail.misconceptionResolved).toBeFalsy();
    expect(recoveryFail.recoveryStatus).toBe("in_recovery");
    expect(recoveryFail.mastery.mastery).toBe(0.0); // No mastery increase

    // Original misconception is still open
    const openMiscs = store.getOpenMisconceptions(studentId, "2nf");
    expect(openMiscs).toContain("confuses-2nf-with-3nf");
  });

  it("5. Correct targeted recovery answer resolves the specific misconception and updates mastery", async () => {
    const store = new SqliteProgressStore(db);

    // Student answers targeted recovery question correctly (Choice A for q-2nf-2)
    const recoverySuccess = await store.recordAttempt({
      studentId,
      questionId: "q-2nf-2",
      answer: "A",
      verdict: "correct",
      recoveryForMisconceptionLabel: "confuses-2nf-with-3nf",
    });

    expect(recoverySuccess.misconceptionResolved).toBe(true);
    expect(recoverySuccess.resolvedMisconceptionLabel).toBe("confuses-2nf-with-3nf");
    expect(recoverySuccess.recoveryStatus).toBe("resolved");
    expect(recoverySuccess.mastery.mastery).toBe(0.25); // 0.0 + 0.25 earned

    // Check open misconceptions list no longer has this label
    const openMiscs = store.getOpenMisconceptions(studentId, "2nf");
    expect(openMiscs).not.toContain("confuses-2nf-with-3nf");

    // Retest status should be marked completed
    const retest = db
      .prepare(
        "SELECT r.status FROM retests r JOIN misconceptions m ON r.misconception_id = m.id WHERE r.student_id = ? AND m.label = ?",
      )
      .get(studentId, "confuses-2nf-with-3nf") as { status: string } | undefined;
    expect(retest?.status).toBe("completed");
  });

  it("6. Persists recovery state and resolution across a fresh database connection", async () => {
    // Close db and reopen new connection
    db.close();
    const reopenedDb = new DatabaseSync(testDbPath);
    const store = new SqliteProgressStore(reopenedDb);

    const openMiscs = store.getOpenMisconceptions(studentId, "2nf");
    // Resolved misconception must not reappear
    expect(openMiscs).not.toContain("confuses-2nf-with-3nf");

    const masteryList = await store.getMastery(studentId, ["2nf"]);
    expect(masteryList[0]?.mastery).toBe(0.25);

    // Check misconception record in DB has resolved_at set
    const miscRow = reopenedDb
      .prepare(
        "SELECT label, resolved_at FROM misconceptions WHERE student_id = ? AND label = ?",
      )
      .get(studentId, "confuses-2nf-with-3nf") as { label: string; resolved_at: string | null } | undefined;
    expect(miscRow?.resolved_at).toBeTruthy();

    reopenedDb.close();
    // Reopen for afterAll
    db = new DatabaseSync(testDbPath);
  });

  it("7. Mastery does not increase from unsupported or unrelated answers", async () => {
    const store = new SqliteProgressStore(db);
    const initialMastery = await store.getMastery(studentId, ["2nf"]);
    const initialScore = initialMastery[0]?.mastery ?? 0;

    // Record an incorrect attempt
    const update = await store.recordAttempt({
      studentId,
      questionId: "q-2nf-1",
      answer: "I don't know",
      verdict: "incorrect",
    });

    expect(update.mastery.mastery).toBeLessThanOrEqual(initialScore);
  });
});
