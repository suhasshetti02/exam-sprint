import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DeterministicAnswerEvaluator,
  DefaultEvidenceVerifier,
  type QuestionRecord,
} from "@exam-sprint/core";
import {
  extractTextFromFile,
  ingestDocument,
  listDocuments,
  deleteDocument,
  openDb,
} from "../lib/server/document-service";
import { startTutoringSession } from "../lib/server/tutoring-policy";

function createValidPdf(text: string): Buffer {
  const contentStream = `BT\n/F1 12 Tf\n72 712 Td\n(${text}) Tj\nET\n`;
  const streamLength = Buffer.byteLength(contentStream, "utf-8");

  const header = "%PDF-1.4\n";
  const obj1 = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  const obj2 = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  const obj3 = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n";
  const obj4 = "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  const obj5 = `5 0 obj\n<< /Length ${streamLength} >>\nstream\n${contentStream}endstream\nendobj\n`;

  const offset1 = Buffer.byteLength(header, "utf-8");
  const offset2 = offset1 + Buffer.byteLength(obj1, "utf-8");
  const offset3 = offset2 + Buffer.byteLength(obj2, "utf-8");
  const offset4 = offset3 + Buffer.byteLength(obj3, "utf-8");
  const offset5 = offset4 + Buffer.byteLength(obj4, "utf-8");
  const xrefOffset = offset5 + Buffer.byteLength(obj5, "utf-8");

  const pad = (n: number) => String(n).padStart(10, "0");
  const xref = [
    "xref\n0 6\n",
    "0000000000 65535 f \n",
    `${pad(offset1)} 00000 n \n`,
    `${pad(offset2)} 00000 n \n`,
    `${pad(offset3)} 00000 n \n`,
    `${pad(offset4)} 00000 n \n`,
    `${pad(offset5)} 00000 n \n`,
    "trailer\n<< /Size 6 /Root 1 0 R >>\n",
    `startxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");

  return Buffer.concat([
    Buffer.from(header, "utf-8"),
    Buffer.from(obj1, "utf-8"),
    Buffer.from(obj2, "utf-8"),
    Buffer.from(obj3, "utf-8"),
    Buffer.from(obj4, "utf-8"),
    Buffer.from(obj5, "utf-8"),
    Buffer.from(xref, "utf-8"),
  ]);
}

describe("PDF Ingestion & Resolution Regression Suite", () => {
  function getRepoRoot(): string {
    let dir = __dirname;
    while (dir && dir !== resolve(dir, "..")) {
      if (existsSync(resolve(dir, "data/local/exam-sprint.db"))) {
        return dir;
      }
      dir = resolve(dir, "..");
    }
    return process.cwd();
  }

  const repoRoot = getRepoRoot();
  const tempDbPath = resolve(repoRoot, "data/local/test-pdf-ingest.db");

  beforeAll(() => {
    const origDb = resolve(repoRoot, "data/local/exam-sprint.db");
    mkdirSync(dirname(tempDbPath), { recursive: true });
    if (existsSync(origDb)) {
      copyFileSync(origDb, tempDbPath);
    }
    process.env.DATABASE_PATH = tempDbPath;
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    if (existsSync(tempDbPath)) {
      try {
        rmSync(tempDbPath, { force: true });
      } catch {
        // Non-fatal cleanup
      }
    }
  });

  // 1. A valid PDF parses and yields expected text
  it("1. Parses a valid PDF and yields the expected extractable text", async () => {
    const pdfBuf = createValidPdf("Relational database schema normalization third normal form");
    const extracted = await extractTextFromFile("normalization-lecture.pdf", pdfBuf);

    expect(extracted.format).toBe("pdf");
    expect(extracted.text).toContain("Relational database schema normalization");
  });

  // 2. Extracted text is chunked and persisted
  it("2. Chunks and persists valid PDF text into SQLite", async () => {
    const text = "Concurrency control in transaction management ensures isolation and consistency using two-phase locking.";
    const pdfBuf = createValidPdf(text);

    const ingestRes = await ingestDocument("concurrency.pdf", pdfBuf);
    expect(ingestRes.success).toBe(true);
    expect(ingestRes.documentId).toBeDefined();
    expect(ingestRes.chunkCount).toBeGreaterThanOrEqual(1);

    const docId = ingestRes.documentId!;

    // 3. The uploaded document appears in the library
    const docs = listDocuments();
    const foundDoc = docs.find((d) => d.id === docId);
    expect(foundDoc).toBeDefined();
    expect(foundDoc?.origin).toBe("student-upload");

    // 4. The document is selectable for a tutoring session
    const sessionRes = await startTutoringSession({
      documentId: docId,
      goal: "quiz",
    });

    expect(sessionRes.question).toBeDefined();
    expect(sessionRes.evidence).toBeDefined();
    expect(sessionRes.evidence?.chunkId).toContain(docId);
    expect(sessionRes.evidence?.status).toBe("verified");
    expect(sessionRes.evidence?.quote).toContain("Concurrency control in transaction management");

    // 5. A generated question uses canonical QuestionRubric schema and evaluates correctly
    const db = openDb();
    const qRow = db
      .prepare(
        "SELECT id, concept_id as conceptId, kind, prompt, choices_json, expected_json FROM questions WHERE id = ?",
      )
      .get(sessionRes.question!.questionId) as {
        id: string;
        conceptId: string;
        kind: "multiple_choice";
        prompt: string;
        choices_json: string;
        expected_json: string;
      };
    db.close();

    expect(qRow).toBeDefined();
    const rubric = JSON.parse(qRow.expected_json);
    expect(rubric).toBeDefined();
    expect(rubric.kind).toBe("multiple_choice");
    expect(["A", "B", "C", "D"]).toContain(rubric.correctAnswer);
    expect(Array.isArray(rubric.acceptableVariants)).toBe(true);

    const verifier = new DefaultEvidenceVerifier();
    const evaluator = new DeterministicAnswerEvaluator(verifier);

    const questionRecord: QuestionRecord = {
      id: qRow.id,
      conceptId: qRow.conceptId,
      kind: qRow.kind,
      prompt: qRow.prompt,
      choices: JSON.parse(qRow.choices_json),
      expected: rubric,
      evidenceChunkId: sessionRes.evidence!.chunkId,
      evidenceQuote: sessionRes.evidence!.quote,
    };

    // Evaluate correct answer
    const evalCorrect = evaluator.evaluate(questionRecord, rubric.correctAnswer);
    expect(evalCorrect.verdict).toBe("correct");

    // Evaluate incorrect answer
    const wrongOption = rubric.correctAnswer === "D" ? "A" : "D";
    const evalIncorrect = evaluator.evaluate(questionRecord, wrongOption);
    expect(evalIncorrect.verdict).toBe("incorrect");

    // Cleanup
    deleteDocument(docId);
  });

  // 6. Malformed or empty PDFs return useful failure without internal path exposure
  it("6. Handles malformed or empty PDFs with sanitized errors and no path leaks", async () => {
    // Empty PDF buffer
    await expect(extractTextFromFile("empty.pdf", Buffer.from(""))).rejects.toThrow(/File is empty/i);

    // Corrupted PDF bytes
    try {
      await extractTextFromFile("corrupted.pdf", Buffer.from("NOT_A_REAL_PDF_STREAM_12345"));
      expect.unreachable("Should have thrown corrupted error");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toMatch(/corrupted|invalid pdf/i);
      // Ensure no internal absolute paths (C:\ or /home/) are leaked
      expect(msg).not.toMatch(/[A-Za-z]:\\[Users|Program Files]/);
      expect(msg).not.toMatch(/\/home\//);
    }
  });

  // 7. TXT and Markdown uploads continue to work
  it("7. Markdown and TXT uploads continue to function seamlessly", async () => {
    const mdBuf = Buffer.from("# Distributed Systems\nConsensus algorithms like Raft and Paxos ensure fault tolerance.\n", "utf8");
    const txtBuf = Buffer.from("Memory management techniques include paging, segmentation, and virtual memory allocation.\n", "utf8");

    const mdRes = await ingestDocument("distributed.md", mdBuf);
    expect(mdRes.success).toBe(true);

    const txtRes = await ingestDocument("memory.txt", txtBuf);
    expect(txtRes.success).toBe(true);

    if (mdRes.documentId) deleteDocument(mdRes.documentId);
    if (txtRes.documentId) deleteDocument(txtRes.documentId);
  });

  // 8. Upload retries and failures do not corrupt existing database records
  it("8. Ingestion failure rolls back cleanly without corrupting database state", async () => {
    const docsBefore = listDocuments().length;

    // Attempting to ingest a corrupted PDF
    const failRes = await ingestDocument("bad.pdf", Buffer.from("NOT_VALID_PDF_DATA"));
    expect(failRes.success).toBe(false);
    expect(failRes.error).toBeDefined();

    // Verify document count did not change and no orphaned partial records were created
    const docsAfter = listDocuments().length;
    expect(docsAfter).toBe(docsBefore);

    // Verify database connection is healthy
    const db = openDb();
    const testQuery = db.prepare("SELECT COUNT(*) as count FROM documents").get() as { count: number };
    expect(testQuery.count).toBe(docsBefore);
    db.close();
  });
});
