import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { ingestDocument, deleteDocument, openDb } from "../lib/server/document-service";
import { startTutoringSession, submitStudentAnswer } from "../lib/server/tutoring-policy";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";

describe("StudyFlow P0 Regression: Document Topic Retrieval & Verification", () => {
  let testDocId: string;

  const TEST_NOTES_CONTENT = `STUDYFLOW TEST NOTES
Subject: Database Management Systems (DBMS)
Purpose: Sample notes for testing document upload, indexing, quiz generation, answer evaluation, and misconception recovery.

========================================
1. DATABASE NORMALIZATION
========================================
Database normalization organizes relational tables to reduce unnecessary data redundancy and prevent insertion, update, and deletion anomalies. It decomposes poorly structured relations into smaller relations while preserving meaningful relationships between the data.

========================================
2. NORMAL FORMS (1NF AND 2NF)
========================================
A relation is in First Normal Form when each attribute contains an atomic value and each field contains a single value rather than a repeating group or a list of values. For example, storing multiple phone numbers in one cell violates the usual 1NF requirement.

A relation is in Second Normal Form when it is in First Normal Form and every non-prime attribute is fully functionally dependent on every candidate key. No non-prime attribute may depend on only a proper subset of a composite candidate key. This eliminates partial functional dependencies.

========================================
3. HIGHER NORMAL FORMS (3NF AND BCNF)
========================================
A relation is in Third Normal Form when it is in Second Normal Form and, for every non-trivial functional dependency X -> A, either X is a superkey or A is a prime attribute. Informally, 3NF addresses certain transitive dependencies involving non-prime attributes.

A relation is in Boyce-Codd Normal Form when every determinant of every non-trivial functional dependency is a superkey. BCNF is stricter than 3NF. A relation can satisfy 3NF and still violate BCNF.

========================================
4. ACID PROPERTIES
========================================
Atomicity: A transaction happens completely or not at all.
Consistency: A transaction preserves database rules and constraints.
Isolation: Concurrent transactions behave according to the database's isolation guarantees.
Durability: Committed changes persist even after a crash or restart.

========================================
5. TRANSACTIONS AND CONCURRENCY
========================================
A transaction is a logical unit of database work. A deadlock occurs when transactions wait in a cycle for resources held by one another. Locking helps control conflicting concurrent access, but poor lock ordering can contribute to deadlocks. A schedule is conflict-serializable when its precedence graph is acyclic.
`;

  beforeAll(async () => {
    // Ingest the test document into the database
    const ingestRes = await ingestDocument(
      "STUDYFLOW TEST NOTES.txt",
      Buffer.from(TEST_NOTES_CONTENT, "utf8"),
    );
    expect(ingestRes.success).toBe(true);
    expect(ingestRes.documentId).toBeDefined();
    testDocId = ingestRes.documentId!;
  });

  afterAll(() => {
    if (testDocId) {
      deleteDocument(testDocId);
    }
  });

  it("1. '2NF' retrieval triggers real MCP search and returns Second Normal Form question & evidence", async () => {
    const res = await startTutoringSession({
      documentId: testDocId,
      topic: "2NF",
      goal: "quiz",
    });

    // Proves actual MCP search call appears in execution trace
    const searchTrace = res.toolTraces.find((t) => t.tool === "search_study_notes");
    expect(searchTrace).toBeDefined();
    expect(searchTrace?.arguments).toMatchObject({
      query: "2NF",
      documentId: testDocId,
    });
    expect(searchTrace?.status).toBe("success");

    // Proves tutoring flow returns a question and evidence
    expect(res.question).toBeDefined();
    expect(res.evidence).toBeDefined();
    expect(res.evidence?.status).toBe("verified");
    expect(res.evidence?.chunkId).toContain(testDocId);

    // Proves evidence quotation addresses Second Normal Form
    expect(res.evidence?.quote.toLowerCase()).toContain("second normal form");
  });

  it("2. 'Second Normal Form' retrieves relevant evidence and verified quote", async () => {
    const res = await startTutoringSession({
      documentId: testDocId,
      topic: "Second Normal Form",
      goal: "quiz",
    });

    expect(res.question).toBeDefined();
    expect(res.evidence).toBeDefined();
    expect(res.evidence?.status).toBe("verified");
    expect(res.evidence?.quote.toLowerCase()).toContain("second normal form");
  });

  it("3. 'partial functional dependency' retrieves the 2NF section", async () => {
    const res = await startTutoringSession({
      documentId: testDocId,
      topic: "partial functional dependency",
      goal: "quiz",
    });

    expect(res.question).toBeDefined();
    expect(res.evidence).toBeDefined();
    expect(res.evidence?.status).toBe("verified");
    expect(res.evidence?.quote.toLowerCase()).toMatch(/partial functional dependencies|second normal form/);
  });

  it("4. 'ACID properties' retrieves the ACID section", async () => {
    const res = await startTutoringSession({
      documentId: testDocId,
      topic: "ACID properties",
      goal: "quiz",
    });

    expect(res.question).toBeDefined();
    expect(res.evidence).toBeDefined();
    expect(res.evidence?.status).toBe("verified");
    expect(res.evidence?.quote).toMatch(/Atomicity|Consistency|Isolation|Durability/);
  });

  it("5. Missing evidence produces an honest failure without invented answers", async () => {
    const res = await startTutoringSession({
      documentId: testDocId,
      topic: "quantum physics",
      goal: "quiz",
    });

    // Proves missing evidence produces an honest failure
    expect(res.question).toBeUndefined();
    expect(res.evidence).toBeUndefined();
    expect(res.message).toContain("I couldn't find grounded notes for \"quantum physics\"");
    expect(res.message).toContain("Please ask about topics covered in this document");

    // Search was still attempted and recorded in the trace
    const searchTrace = res.toolTraces.find((t) => t.tool === "search_study_notes");
    expect(searchTrace).toBeDefined();
  });

  it("6. runTutoringOrchestration routes documentId to document-scoped retrieval", async () => {
    const res = await runTutoringOrchestration({
      action: "start_session",
      documentId: testDocId,
      topic: "2NF",
      goal: "quiz",
    });

    expect(res.question).toBeDefined();
    expect(res.evidence).toBeDefined();
    expect(res.evidence?.status).toBe("verified");
    expect(res.evidence?.quote.toLowerCase()).toContain("second normal form");

    const searchTrace = res.toolTraces.find((t) => t.tool === "search_study_notes");
    expect(searchTrace).toBeDefined();
  });

  it("7. Student answer evaluation on document question verifies evidence and records progress", async () => {
    const session = await startTutoringSession({
      documentId: testDocId,
      topic: "2NF",
      goal: "quiz",
    });

    expect(session.question).toBeDefined();

    const db = openDb();
    const qRow = db.prepare("SELECT expected_json FROM questions WHERE id = ?").get(session.question!.questionId) as { expected_json: string };
    db.close();
    const correctLetter = JSON.parse(qRow.expected_json).correctAnswer;

    const evalRes = await submitStudentAnswer({
      questionId: session.question!.questionId,
      answer: correctLetter,
    });

    expect(evalRes.evaluation).toBeDefined();
    expect(evalRes.evaluation?.verdict).toBe("correct");
    expect(evalRes.toolTraces.some((t) => t.tool === "evaluate_answer")).toBe(true);
    expect(evalRes.toolTraces.some((t) => t.tool === "record_progress")).toBe(true);
  });
});
