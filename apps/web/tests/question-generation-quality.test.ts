import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DefaultEvidenceVerifier,
  DeterministicAnswerEvaluator,
  type QuestionRecord,
  type SourceChunk,
} from "@exam-sprint/core";
import {
  createQuestionForChunk,
  deleteDocument,
  ingestDocument,
  openDb,
} from "../lib/server/document-service";
import {
  startTutoringSession,
  submitStudentAnswer,
} from "../lib/server/tutoring-policy";

describe("Question Generation Quality & Schema Regression Suite", () => {
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

  it("1. Generates a meaningful concept question for 2NF instead of a generic section question", () => {
    const chunk: SourceChunk = {
      id: `${testDocId}_chunk_1`,
      documentId: testDocId,
      heading: "Section 2: NORMAL FORMS (1NF AND 2NF)",
      ordinal: 1,
      text: "A relation is in Second Normal Form when it is in First Normal Form and every non-prime attribute is fully functionally dependent on every candidate key. No non-prime attribute may depend on only a proper subset of a composite candidate key. This eliminates partial functional dependencies.",
    };

    const q = createQuestionForChunk(chunk, "concept-2nf", "2NF");
    expect(q).not.toBeNull();
    if (!q) return;

    // Must NOT be the generic "Based on the section 'Section 2'..."
    expect(q.prompt).not.toContain("Based on the section 'Section 2'");
    expect(q.prompt).not.toContain("Based on the section \"Section 2\"");
    // Must be a meaningful question about the concept
    expect(q.prompt).toBe("Which condition must a relation satisfy to be in Second Normal Form (2NF)?");
  });

  it("2. Produces four complete, distinct choices without malformed distractors", () => {
    const chunk: SourceChunk = {
      id: `${testDocId}_chunk_1`,
      documentId: testDocId,
      heading: "Section 2: NORMAL FORMS (1NF AND 2NF)",
      ordinal: 1,
      text: "A relation is in Second Normal Form when it is in First Normal Form and every non-prime attribute is fully functionally dependent on every candidate key. No non-prime attribute may depend on only a proper subset of a composite candidate key. This eliminates partial functional dependencies.",
    };

    const q = createQuestionForChunk(chunk, "concept-2nf", "2NF");
    expect(q).not.toBeNull();
    if (!q) return;

    // Guardrail: Exactly 4 choices
    expect(q.choices).toHaveLength(4);

    // Guardrail: No duplicates
    const uniqueChoices = new Set(q.choices);
    expect(uniqueChoices.size).toBe(4);

    // Guardrail: No malformed "The opposite of..." pattern
    for (const choice of q.choices) {
      expect(choice).not.toMatch(/^The opposite of/i);
      expect(choice).not.toContain("The opposite of");
    }

    // Guardrail: No truncated sentences or ellipses
    for (const choice of q.choices) {
      expect(choice).not.toContain("...");
      expect(choice).not.toContain("…");
      expect(choice.length).toBeGreaterThanOrEqual(20);
      // Choices must look like complete grammatical statements
      expect(choice.trim()).toMatch(/^[A-Z].*[.?!]$/);
    }
  });

  it("3. Confirms the canonical question schema and evidence grounding", () => {
    const chunk: SourceChunk = {
      id: `${testDocId}_chunk_1`,
      documentId: testDocId,
      heading: "Section 2: NORMAL FORMS (1NF AND 2NF)",
      ordinal: 1,
      text: "A relation is in Second Normal Form when it is in First Normal Form and every non-prime attribute is fully functionally dependent on every candidate key. No non-prime attribute may depend on only a proper subset of a composite candidate key. This eliminates partial functional dependencies.",
    };

    const q = createQuestionForChunk(chunk, "concept-2nf", "2NF");
    expect(q).not.toBeNull();
    if (!q) return;

    // Canonical QuestionRecord structure
    expect(q.id).toBeDefined();
    expect(q.conceptId).toBe("concept-2nf");
    expect(q.kind).toBe("multiple_choice");
    expect(q.expected.kind).toBe("multiple_choice");
    expect(["A", "B", "C", "D"]).toContain(q.expected.correctAnswer);
    expect(q.expected.acceptableVariants).toBeDefined();
    expect(q.expected.explanation).toContain(q.evidenceQuote);

    // Grounded quote verification
    const verifier = new DefaultEvidenceVerifier();
    const verification = verifier.verify(
      {
        chunkId: chunk.id,
        quote: q.evidenceQuote,
        start: q.evidenceStart,
        end: q.evidenceEnd,
      },
      chunk,
    );
    expect(verification.status).toBe("verified");
    expect(chunk.text.slice(q.evidenceStart, q.evidenceEnd)).toBe(q.evidenceQuote);
  });

  it("4. Evaluates correct answer ('A') and incorrect answers ('B', 'C', 'D') deterministically", () => {
    const chunk: SourceChunk = {
      id: `${testDocId}_chunk_1`,
      documentId: testDocId,
      heading: "Section 2: NORMAL FORMS (1NF AND 2NF)",
      ordinal: 1,
      text: "A relation is in Second Normal Form when it is in First Normal Form and every non-prime attribute is fully functionally dependent on every candidate key.",
    };

    const q = createQuestionForChunk(chunk, "concept-2nf", "2NF");
    expect(q).not.toBeNull();
    if (!q) return;

    const verifier = new DefaultEvidenceVerifier();
    const evaluator = new DeterministicAnswerEvaluator(verifier);
    const questionRecord: QuestionRecord = {
      id: q.id,
      conceptId: q.conceptId,
      kind: q.kind,
      prompt: q.prompt,
      choices: q.choices,
      expected: q.expected,
      evidenceChunkId: chunk.id,
      evidenceQuote: q.evidenceQuote,
      evidenceStart: q.evidenceStart,
      evidenceEnd: q.evidenceEnd,
      verifiedAt: new Date().toISOString(),
    };

    const correctLetter = q.expected.correctAnswer;
    const correctIndex = correctLetter.charCodeAt(0) - 65;

    // Evaluates displayed correct answer letter deterministically
    const evalCorrect = evaluator.evaluate(questionRecord, correctLetter);
    expect(evalCorrect.verdict).toBe("correct");

    // Choice by full text of the correct option must evaluate to correct (acceptableVariant)
    const evalCorrectText = evaluator.evaluate(questionRecord, q.choices[correctIndex]!);
    expect(evalCorrectText.verdict).toBe("correct");

    // All other options must evaluate to incorrect
    const options = ["A", "B", "C", "D"];
    for (const opt of options) {
      if (opt !== correctLetter) {
        const evalDistractor = evaluator.evaluate(questionRecord, opt);
        expect(evalDistractor.verdict).toBe("incorrect");
      }
    }
  });

  it("5. Abstains cleanly when chunk content cannot satisfy question quality requirements", () => {
    const ungroundedChunk: SourceChunk = {
      id: `${testDocId}_empty`,
      documentId: testDocId,
      heading: "Empty",
      ordinal: 99,
      text: "Hi.", // Less than 25 characters, cannot produce complete sentences
    };

    const q = createQuestionForChunk(ungroundedChunk, "concept-empty");
    expect(q).toBeNull();
  });

  it("6. End-to-end startTutoringSession returns high-quality 2NF question in live session", async () => {
    const session = await startTutoringSession({
      documentId: testDocId,
      topic: "2NF",
      goal: "quiz",
    });

    expect(session.question).toBeDefined();
    const q = session.question!;

    // Assert the prompt is concept-specific
    expect(q.prompt).toBe("Which condition must a relation satisfy to be in Second Normal Form (2NF)?");

    // Assert 4 choices
    expect(q.choices).toBeDefined();
    expect(q.choices).toHaveLength(4);

    // Assert no "The opposite of..." or ellipses
    for (const choice of q.choices!) {
      expect(choice).not.toMatch(/^The opposite of/i);
      expect(choice).not.toContain("...");
      expect(choice).not.toContain("…");
    }

    const db = openDb();
    const qRow = db.prepare("SELECT expected_json FROM questions WHERE id = ?").get(q.questionId) as { expected_json: string };
    db.close();
    const correctLetter = JSON.parse(qRow.expected_json).correctAnswer;
    const incorrectLetter = ["A", "B", "C", "D"].find((l) => l !== correctLetter)!;

    // Submit correct answer -> correct
    const evalResCorrect = await submitStudentAnswer({
      questionId: q.questionId,
      answer: correctLetter,
    });
    expect(evalResCorrect.evaluation?.verdict).toBe("correct");

    // Submit incorrect answer -> incorrect
    const evalResIncorrect = await submitStudentAnswer({
      questionId: q.questionId,
      answer: incorrectLetter,
    });
    expect(evalResIncorrect.evaluation?.verdict).toBe("incorrect");
  });
});
