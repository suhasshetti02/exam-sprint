#!/usr/bin/env node
/**
 * Safely seeds curated demo data for the local development student.
 * Creates an automatic timestamped backup of data/local/exam-sprint.db before making any changes.
 *
 * Curated demo state:
 * - 1NF: 3 attempts, 100% mastery (competent)
 * - 2NF: 3 attempts, 33% mastery, open misconception: 'confuses-2nf-with-3nf' (flagged weak concept)
 * - Normalization Basics: 2 attempts, 50% mastery
 * - ACID: 2 attempts, 100% mastery
 * - BCNF, 3NF, Functional Dependencies, Isolation Levels: 0 attempts (ready for fresh testing)
 *
 * Usage: npm run db:demo-seed
 */

import { copyFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = resolve(root, process.env.DATABASE_PATH ?? "data/local/exam-sprint.db");

if (!existsSync(dbPath)) {
  console.error(`Database not found at ${dbPath}. Please run npm run db:init first.`);
  process.exit(1);
}

// 1. Create a safe timestamped backup first
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = `${dbPath}.backup-${timestamp}`;
copyFileSync(dbPath, backupPath);
console.log(`✓ Safety backup created at: ${backupPath}`);

// 2. Open database and prepare curated demo progress
const db = new DatabaseSync(dbPath);
const studentId = "local-student";

db.exec("BEGIN");
try {
  // Ensure student exists
  db.prepare("INSERT OR IGNORE INTO students (id) VALUES (?)").run(studentId);

  // Clear existing student progress (only for local-student)
  db.prepare("DELETE FROM misconceptions WHERE student_id = ?").run(studentId);
  db.prepare("DELETE FROM attempts WHERE student_id = ?").run(studentId);
  db.prepare("DELETE FROM concept_mastery WHERE student_id = ?").run(studentId);

  // Seed curated demo attempts
  const insertAttempt = db.prepare(`
    INSERT INTO attempts (id, student_id, question_id, answer_text, verdict, evidence_chunk_id, evidence_quote, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMastery = db.prepare(`
    INSERT INTO concept_mastery (student_id, concept_id, mastery, attempts_count, last_attempt_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMisconception = db.prepare(`
    INSERT INTO misconceptions (id, student_id, concept_id, label, description, first_seen_at, last_seen_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `);

  const now = new Date().toISOString();

  // 1NF: Competent (3 correct attempts)
  insertAttempt.run("att-demo-1nf-1", studentId, "q-1nf-1", "Atomic attributes only", "correct", "dbms-normalization#first-normal-form", "Every attribute value must be atomic", now);
  insertAttempt.run("att-demo-1nf-2", studentId, "q-1nf-1", "No repeating groups", "correct", "dbms-normalization#first-normal-form", "Every attribute value must be atomic", now);
  insertAttempt.run("att-demo-1nf-3", studentId, "q-1nf-1", "Atomic values and unique rows", "correct", "dbms-normalization#first-normal-form", "Every attribute value must be atomic", now);
  insertMastery.run(studentId, "1nf", 1.0, 3, now);

  // 2NF: Weak concept for demo (1 correct, 2 incorrect with diagnosed misconception)
  insertAttempt.run("att-demo-2nf-1", studentId, "q-2nf-1", "Transitive dependencies", "incorrect", "dbms-normalization#second-normal-form", "Partial dependencies are the problem this form removes", now);
  insertAttempt.run("att-demo-2nf-2", studentId, "q-2nf-1", "Transitive dependencies removed", "incorrect", "dbms-normalization#second-normal-form", "Partial dependencies are the problem this form removes", now);
  insertAttempt.run("att-demo-2nf-3", studentId, "q-2nf-1", "Partial dependencies removed", "correct", "dbms-normalization#second-normal-form", "Partial dependencies are the problem this form removes", now);
  insertMastery.run(studentId, "2nf", 0.33, 3, now);
  insertMisconception.run(
    "misc-demo-2nf-1",
    studentId,
    "2nf",
    "confuses-2nf-with-3nf",
    "Confuses 2NF (partial dependencies) with 3NF (transitive dependencies)",
    now,
    now,
  );

  // Normalization basics: 50% mastery
  insertAttempt.run("att-demo-norm-1", studentId, "q-norm-1", "To optimize disk space", "incorrect", "dbms-normalization#why-normalize", "Redundancy leads to anomalies", now);
  insertAttempt.run("att-demo-norm-2", studentId, "q-norm-1", "To eliminate data anomalies", "correct", "dbms-normalization#why-normalize", "Redundancy leads to anomalies", now);
  insertMastery.run(studentId, "normalization-basics", 0.5, 2, now);

  // ACID: 100% mastery
  insertAttempt.run("att-demo-acid-1", studentId, "q-acid-1", "Atomicity, Consistency, Isolation, Durability", "correct", "dbms-transactions#acid-properties", "ACID guarantees transactional reliability", now);
  insertAttempt.run("att-demo-acid-2", studentId, "q-acid-1", "All or nothing execution", "correct", "dbms-transactions#acid-properties", "ACID guarantees transactional reliability", now);
  insertMastery.run(studentId, "acid", 1.0, 2, now);

  // Concepts with 0 attempts: bcnf, 3nf, functional-dependencies, isolation-levels
  insertMastery.run(studentId, "bcnf", 0.0, 0, null);
  insertMastery.run(studentId, "3nf", 0.0, 0, null);
  insertMastery.run(studentId, "functional-dependencies", 0.0, 0, null);
  insertMastery.run(studentId, "isolation-levels", 0.0, 0, null);

  db.exec("COMMIT");
  console.log("✓ Curated demo progress seeded successfully for 'local-student'.");
  console.log("  - 1NF: 3 attempts, 100% mastery (Competent)");
  console.log("  - 2NF: 3 attempts, 33% mastery, open misconception: 'confuses-2nf-with-3nf' (Flagged weak concept)");
  console.log("  - Normalization Basics: 2 attempts, 50% mastery");
  console.log("  - ACID: 2 attempts, 100% mastery");
  console.log("  - BCNF, 3NF, Functional Dependencies, Isolation Levels: 0 attempts (Fresh)");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("Failed to seed demo progress:", err);
  process.exit(1);
} finally {
  db.close();
}
