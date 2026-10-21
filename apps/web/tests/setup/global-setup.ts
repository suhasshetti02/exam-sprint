import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  applyMigrations,
  seedConcepts,
  seedNotes,
  seedQuestions,
} from "../../../../scripts/db-init.mjs";
import { createApp } from "../../../../apps/mcp-server/src/app";

let tempDir: string | null = null;
let server: Server | null = null;

export function seedTestProgress(db: DatabaseSync, studentId = "local-student") {
  db.prepare("INSERT OR IGNORE INTO students (id) VALUES (?)").run(studentId);

  db.prepare("DELETE FROM misconceptions WHERE student_id = ?").run(studentId);
  db.prepare("DELETE FROM attempts WHERE student_id = ?").run(studentId);
  db.prepare("DELETE FROM concept_mastery WHERE student_id = ?").run(studentId);

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

  // 2NF: Weak concept for tests (1 correct, 2 incorrect with diagnosed misconception)
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
  insertAttempt.run("att-demo-norm-1", studentId, "q-norm-basics-1", "To optimize disk space", "incorrect", "dbms-normalization#why-normalize", "Redundancy leads to anomalies", now);
  insertAttempt.run("att-demo-norm-2", studentId, "q-norm-basics-1", "To eliminate data anomalies", "correct", "dbms-normalization#why-normalize", "Redundancy leads to anomalies", now);
  insertMastery.run(studentId, "normalization-basics", 0.5, 2, now);

  // Fresh concepts with 0 attempts (ready for fresh test assertions)
  insertMastery.run(studentId, "acid", 0.0, 0, null);
  insertMastery.run(studentId, "bcnf", 0.0, 0, null);
  insertMastery.run(studentId, "3nf", 0.0, 0, null);
  insertMastery.run(studentId, "functional-dependencies", 0.0, 0, null);
  insertMastery.run(studentId, "isolation-levels", 0.0, 0, null);
}

export async function setup() {
  // 1. Prepare isolated test database in a uniquely created temporary directory
  tempDir = mkdtempSync(join(tmpdir(), "exam-sprint-test-"));
  const testDbPath = join(tempDir, "test-web-suite.db");

  const db = new DatabaseSync(testDbPath);
  try {
    applyMigrations(db);
    seedConcepts(db);
    seedNotes(db);
    seedQuestions(db);
    seedTestProgress(db, "local-student");
  } finally {
    db.close();
  }

  // Configure environment variables so in-process MCP server and web tests use the isolated test DB
  process.env.DATABASE_PATH = testDbPath;

  // 2. Start isolated in-process MCP server on an ephemeral available port (listen(0))
  const app = createApp();
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", () => resolve());
    server!.once("error", (err) => reject(err));
  });

  const addr = server.address() as AddressInfo;
  if (!addr || typeof addr.port !== "number") {
    throw new Error("Failed to obtain listening port for isolated MCP test server");
  }

  process.env.MCP_SERVER_URL = `http://127.0.0.1:${addr.port}/mcp`;
}

export async function teardown() {
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = null;
  }

  if (tempDir && existsSync(tempDir)) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore removal failure on exit
    }
    tempDir = null;
  }
}
