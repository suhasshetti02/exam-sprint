import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyMigrations, seedConcepts, seedNotes, seedQuestions } from "../scripts/db-init.mjs";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  applyMigrations(db);
  return db;
}

describe("SQLite migrations", () => {
  it("applies cleanly and is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    expect(applyMigrations(db)).toEqual([
      "001_init.sql",
      "002_rapid_fire.sql",
      "003_idempotent_attempts.sql",
    ]);
    expect(applyMigrations(db)).toEqual([]);
  });

  it("enforces client_attempt_id uniqueness per student while allowing NULLs", () => {
    const db = freshDb();
    seedConcepts(db);
    db.prepare("INSERT INTO students (id) VALUES ('s1'), ('s2')").run();
    // Seed sample notes and a question for attempts foreign keys
    seedNotes(db);
    seedQuestions(db);
    const qRow = db.prepare("SELECT id, evidence_chunk_id, evidence_quote FROM questions LIMIT 1").get() as {
      id: string;
      evidence_chunk_id: string;
      evidence_quote: string;
    };

    // First attempt with client_attempt_id 'cli_1' succeeds
    db.prepare(
      `INSERT INTO attempts (id, student_id, question_id, answer_text, verdict, evidence_chunk_id, evidence_quote, client_attempt_id)
       VALUES ('att_1', 's1', ?, 'A', 'correct', ?, ?, 'cli_1')`,
    ).run(qRow.id, qRow.evidence_chunk_id, qRow.evidence_quote);

    // Duplicate client_attempt_id 'cli_1' for the same student fails
    expect(() =>
      db.prepare(
        `INSERT INTO attempts (id, student_id, question_id, answer_text, verdict, evidence_chunk_id, evidence_quote, client_attempt_id)
         VALUES ('att_2', 's1', ?, 'B', 'incorrect', ?, ?, 'cli_1')`,
      ).run(qRow.id, qRow.evidence_chunk_id, qRow.evidence_quote),
    ).toThrow();

    // Same client_attempt_id 'cli_1' for a different student s2 succeeds
    expect(() =>
      db.prepare(
        `INSERT INTO attempts (id, student_id, question_id, answer_text, verdict, evidence_chunk_id, evidence_quote, client_attempt_id)
         VALUES ('att_3', 's2', ?, 'A', 'correct', ?, ?, 'cli_1')`,
      ).run(qRow.id, qRow.evidence_chunk_id, qRow.evidence_quote),
    ).not.toThrow();

    // Multiple NULL client_attempt_id rows succeed (backwards compatibility)
    expect(() =>
      db.prepare(
        `INSERT INTO attempts (id, student_id, question_id, answer_text, verdict, evidence_chunk_id, evidence_quote, client_attempt_id)
         VALUES ('att_4', 's1', ?, 'A', 'correct', ?, ?, NULL)`,
      ).run(qRow.id, qRow.evidence_chunk_id, qRow.evidence_quote),
    ).not.toThrow();
    expect(() =>
      db.prepare(
        `INSERT INTO attempts (id, student_id, question_id, answer_text, verdict, evidence_chunk_id, evidence_quote, client_attempt_id)
         VALUES ('att_5', 's1', ?, 'A', 'correct', ?, ?, NULL)`,
      ).run(qRow.id, qRow.evidence_chunk_id, qRow.evidence_quote),
    ).not.toThrow();
  });

  it("creates the planned tables", () => {
    const db = freshDb();
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r["name"]));
    for (const t of ["documents", "chunks", "concepts", "questions", "attempts", "concept_mastery", "misconceptions", "retests", "challenge_runs", "challenge_question_slots"]) {
      expect(names).toContain(t);
    }
  });

  it("seeds the concept catalogue and nothing about students", () => {
    const db = freshDb();
    expect(seedConcepts(db)).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM students").get()?.["n"]).toBe(0);
  });

  it("rejects mastery outside 0..1 and unverified-evidence-free questions", () => {
    const db = freshDb();
    seedConcepts(db);
    db.prepare("INSERT INTO students (id) VALUES ('s1')").run();
    expect(() => db.prepare("INSERT INTO concept_mastery (student_id, concept_id, mastery) VALUES ('s1','bcnf', 1.5)").run()).toThrow();
    expect(() =>
      db.prepare("INSERT INTO questions (id, concept_id, kind, prompt, expected_json, evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at) VALUES ('q','bcnf','short_answer','p','{}','missing-chunk','x',0,1,'now')").run(),
    ).toThrow();
  });
});

describe("seedNotes", () => {
  it("ingests at least one chunk from each sample-notes document", () => {
    const db = freshDb();
    seedConcepts(db); // ensures documents stub exists for FK
    const count = seedNotes(db);
    expect(count).toBeGreaterThan(0);
    // Both sample documents should have chunks
    const docIds = db
      .prepare("SELECT DISTINCT document_id FROM chunks")
      .all()
      .map((r) => String(r["document_id"]));
    expect(docIds).toContain("dbms-normalization");
    expect(docIds).toContain("dbms-transactions");
  });

  it("chunk IDs follow the <documentId>#<slug> pattern", () => {
    const db = freshDb();
    seedConcepts(db);
    seedNotes(db);
    const ids = db
      .prepare("SELECT id FROM chunks WHERE document_id = 'dbms-normalization'")
      .all()
      .map((r) => String(r["id"]));
    expect(ids).toContain("dbms-normalization#why-normalize");
    expect(ids).toContain("dbms-normalization#functional-dependencies");
  });

  it("re-running seedNotes is idempotent (same chunk count, no duplicates)", () => {
    const db = freshDb();
    seedConcepts(db);
    const first = seedNotes(db);
    const second = seedNotes(db);
    // Both calls process the same number of files
    expect(first).toBe(second);
    // Actual stored rows must not have duplicated
    const stored = Number(db.prepare("SELECT COUNT(*) AS n FROM chunks").get()?.["n"]);
    expect(stored).toBe(first);
  });

  it("stores content_hash for each chunk", () => {
    const db = freshDb();
    seedConcepts(db);
    seedNotes(db);
    const hashes = db
      .prepare("SELECT content_hash FROM chunks")
      .all()
      .map((r) => String(r["content_hash"]));
    for (const h of hashes) {
      expect(h).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    }
  });

  it("updates text when content_hash changes (simulated edit)", () => {
    const db = freshDb();
    seedConcepts(db);
    seedNotes(db);
    // Manually corrupt a chunk to simulate a stale row
    db.prepare("UPDATE chunks SET text = 'stale text', content_hash = 'aabbcc' WHERE id = 'dbms-normalization#why-normalize'").run();
    // Re-run — should restore the correct text
    seedNotes(db);
    const row = db.prepare("SELECT text FROM chunks WHERE id = 'dbms-normalization#why-normalize'").get();
    expect(String(row?.["text"])).not.toBe("stale text");
    expect(String(row?.["text"])).toContain("Normalization organizes");
  });
});

describe("seedQuestions", () => {
  it("seeds questions and ensures all evidence quotes have verified offsets", () => {
    const db = freshDb();
    seedConcepts(db);
    seedNotes(db);
    const count = seedQuestions(db);
    expect(count).toBeGreaterThanOrEqual(16);

    const questions = db.prepare("SELECT * FROM questions").all() as Array<{
      id: string;
      concept_id: string;
      evidence_start: number;
      evidence_end: number;
      verified_at: string;
    }>;
    expect(questions.length).toBe(count);

    for (const q of questions) {
      expect(q.evidence_start).toBeGreaterThanOrEqual(0);
      expect(q.evidence_end).toBeGreaterThan(q.evidence_start);
      expect(q.verified_at).toBeTruthy();
    }
  });

  it("re-running seedQuestions is idempotent", () => {
    const db = freshDb();
    seedConcepts(db);
    seedNotes(db);
    const first = seedQuestions(db);
    const second = seedQuestions(db);
    expect(first).toBe(second);
    const total = Number(db.prepare("SELECT COUNT(*) as n FROM questions").get()?.["n"]);
    expect(total).toBe(first);
  });
});

