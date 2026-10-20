import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DefaultEvidenceVerifier,
  type SourceChunk,
} from "@exam-sprint/core";
import {
  createQuestionForChunk,
  deleteDocument,
  getDocumentTopics,
  ingestDocument,
  listDocuments,
  openDb,
} from "../lib/server/document-service";
import {
  startTutoringSession,
  submitStudentAnswer,
} from "../lib/server/tutoring-policy";

describe("Document-Adaptive Learning & Question Quality Regression Suite", () => {
  let execDocId: string;
  let dbmsDocId: string;
  let genericDocId: string;
  let sparseDocId: string;

  const EXEC_SUMMARY_CONTENT = `EXECUTIVE SUMMARY: DEVOPS COMPANION
1. Executive Summary
This document outlines the strategic roadmap for the DevOps Companion initiative. The project aims to reduce incident response times and bridge collaboration silos across engineering and operations teams.

2. Problem Statement
Incident resolution across distributed systems currently suffers from fragmented telemetry and manual triage workflows. Root cause analysis is delayed by an average of 42 minutes due to siloed communication channels and scattered log repositories.

3. Solution Architecture
The DevOps Companion introduces unified incident correlation and automated runbook generation. Key capabilities include real-time metric anomaly detection, dynamic stakeholder notifications, and automated rollback triggers for deployment failures.

4. Expected Outcomes
The platform targets a 60% reduction in mean time to acknowledge (MTTA) and a 45% reduction in mean time to recovery (MTTR). Full production deployment is scheduled across all tier-one services by Q3.
`;

  const DBMS_NOTES_CONTENT = `DATABASE MANAGEMENT SYSTEMS
1. Database Normalization
Database normalization organizes relational tables to reduce redundancy and prevent insertion, update, and deletion anomalies.

2. Normal Forms (1NF and 2NF)
A relation is in First Normal Form when each attribute contains an atomic value and each field contains a single value rather than a repeating group.
A relation is in Second Normal Form when it is in First Normal Form and every non-prime attribute is fully functionally dependent on every candidate key.

3. ACID Properties
Atomicity ensures that a transaction happens completely or not at all.
Consistency guarantees that a transaction preserves database rules and constraints.
Isolation ensures concurrent transactions execute without cross-transaction interference.
Durability guarantees that committed changes persist even after a system crash.
`;

  const GENERIC_HEADINGS_CONTENT = `SYSTEM OVERVIEW
Section 1
Authentication mechanisms verify user identity using public key cryptography and secure JSON Web Tokens.

Section 2
Rate limiting controls incoming traffic using a distributed token bucket algorithm to prevent service denial.
`;

  const SPARSE_CONTENT = `Intro.
Appendix only.
`;

  beforeAll(async () => {
    const execRes = await ingestDocument(
      "Executive Summary.txt",
      Buffer.from(EXEC_SUMMARY_CONTENT, "utf8"),
    );
    expect(execRes.success).toBe(true);
    execDocId = execRes.documentId!;

    const dbmsRes = await ingestDocument(
      "DBMS Notes.txt",
      Buffer.from(DBMS_NOTES_CONTENT, "utf8"),
    );
    expect(dbmsRes.success).toBe(true);
    dbmsDocId = dbmsRes.documentId!;

    const genericRes = await ingestDocument(
      "Generic Headings Doc.txt",
      Buffer.from(GENERIC_HEADINGS_CONTENT, "utf8"),
    );
    expect(genericRes.success).toBe(true);
    genericDocId = genericRes.documentId!;

    const sparseRes = await ingestDocument(
      "Sparse Doc.txt",
      Buffer.from(SPARSE_CONTENT, "utf8"),
    );
    expect(sparseRes.success).toBe(true);
    sparseDocId = sparseRes.documentId!;
  });

  afterAll(() => {
    if (execDocId) deleteDocument(execDocId);
    if (dbmsDocId) deleteDocument(dbmsDocId);
    if (genericDocId) deleteDocument(genericDocId);
    if (sparseDocId) deleteDocument(sparseDocId);
  });

  // 1. Dynamic topic suggestions for Executive Summary
  it("Phase 2.1: derives topic suggestions from Executive Summary chunks, not hardcoded DBMS", () => {
    const topics = getDocumentTopics(execDocId);
    expect(topics.length).toBeGreaterThan(0);

    const topicTitles = topics.map((t) => t.topic.toLowerCase());
    // Must NOT contain DBMS topics
    expect(topicTitles.some((t) => t.includes("1nf") || t.includes("2nf") || t.includes("bcnf"))).toBe(false);
    expect(topicTitles.some((t) => t.includes("acid"))).toBe(false);
    expect(topicTitles.some((t) => t.includes("normalization"))).toBe(false);

    // Must contain Executive Summary relevant topics
    expect(
      topicTitles.some(
        (t) =>
          t.includes("executive summary") ||
          t.includes("problem statement") ||
          t.includes("solution") ||
          t.includes("outcomes"),
      ),
    ).toBe(true);
  });

  // 2. Dynamic topic suggestions for DBMS document
  it("Phase 2.2: derives DBMS topics for DBMS document", () => {
    const topics = getDocumentTopics(dbmsDocId);
    expect(topics.length).toBeGreaterThan(0);
    const topicTitles = topics.map((t) => t.topic.toLowerCase());
    expect(
      topicTitles.some(
        (t) =>
          t.includes("normalization") ||
          t.includes("normal forms") ||
          t.includes("acid") ||
          t.includes("1nf") ||
          t.includes("2nf"),
      ),
    ).toBe(true);
  });

  // 3. Updating suggestions after switching between documents
  it("Phase 2.3: topic suggestions update distinctly when switching documents", () => {
    const execTopics = getDocumentTopics(execDocId);
    const dbmsTopics = getDocumentTopics(dbmsDocId);

    const execSet = new Set(execTopics.map((t) => t.topic));
    const dbmsSet = new Set(dbmsTopics.map((t) => t.topic));

    // Overlap should be empty or completely distinct
    const intersection = [...execSet].filter((x) => dbmsSet.has(x));
    expect(intersection.length).toBe(0);
  });

  // 4. Handling a document with generic headings
  it("Phase 2.4: cleans generic 'Section 1' headings and extracts meaningful topic names", () => {
    const topics = getDocumentTopics(genericDocId);
    expect(topics.length).toBeGreaterThan(0);
    // None should start with "1. " or "Section 1"
    for (const t of topics) {
      expect(t.topic).not.toMatch(/^section\s+\d+$/i);
    }
  });

  // 5. Handling a document with no reliable candidate topics
  it("Phase 2.5: provides safe fallback topic when document has sparse structure", () => {
    const topics = getDocumentTopics(sparseDocId);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0]?.topic).toBe("Study Full Document");
  });

  // 6. Ensuring suggestions map to source chunk IDs
  it("Phase 2.6: suggested topics tie directly to valid source chunk IDs in that document", () => {
    const topics = getDocumentTopics(execDocId);
    for (const t of topics) {
      expect(t.chunkId).toBeDefined();
      expect(t.chunkId).toContain(execDocId);
    }
  });

  // 7. Document-scoped retrieval & prevention of cross-document leakage
  it("Phase 3.1: session creates questions and evidence scoped strictly to selected document", async () => {
    const sessionRes = await startTutoringSession({
      documentId: execDocId,
      topic: "Problem Statement",
      goal: "quiz",
    });

    expect(sessionRes.evidence).toBeDefined();
    expect(sessionRes.evidence?.chunkId).toContain(execDocId);
    expect(sessionRes.evidence?.status).toBe("verified");
    // Does NOT contain DBMS text
    expect(sessionRes.evidence?.quote.toLowerCase()).not.toContain("normalization");
    expect(sessionRes.evidence?.quote.toLowerCase()).not.toContain("candidate key");

    if (sessionRes.question && sessionRes.question.choices) {
      expect(sessionRes.question.conceptId).toContain(execDocId);
      for (const choice of sessionRes.question.choices) {
        expect(choice.toLowerCase()).not.toContain("normalization");
        expect(choice.toLowerCase()).not.toContain("candidate key");
      }
    }
  });

  // 8. Question generation quality: 4 distinct choices, complete sentences, no ellipses
  it("Phase 4.1: generates 4 distinct, complete options with category alignment", async () => {
    const sessionRes = await startTutoringSession({
      documentId: execDocId,
      topic: "Problem Statement",
      goal: "quiz",
    });

    expect(sessionRes.question).toBeDefined();
    const q = sessionRes.question!;
    expect(q.choices?.length).toBe(4);

    // 4 distinct choices
    const uniqueChoices = new Set(q.choices!);
    expect(uniqueChoices.size).toBe(4);

    // None should have ellipses or broken starts
    for (const choice of q.choices!) {
      expect(choice).not.toContain("...");
      expect(choice).not.toMatch(/^during\b/i);
      expect(choice).not.toMatch(/^which\b/i);
      expect(choice).not.toMatch(/^\(e\.g\./i);
      expect(choice).not.toMatch(/^The opposite of/i);
      expect(choice.length).toBeGreaterThan(15);
      // Parentheses should be balanced
      const openCount = (choice.match(/\(/g) || []).length;
      const closeCount = (choice.match(/\)/g) || []).length;
      expect(openCount).toBe(closeCount);
    }
  });

  // 9. Rubric alignment & deterministic evaluation
  it("Phase 4.2: option A is the correct answer and aligns with canonicalAnswer rubric", async () => {
    const sessionRes = await startTutoringSession({
      documentId: execDocId,
      topic: "Problem Statement",
      goal: "quiz",
    });

    const q = sessionRes.question!;
    expect(q.choices).toBeDefined();
    expect(q.choices?.length).toBe(4);

    // Correct submission evaluation
    const evalCorrect = await submitStudentAnswer({
      questionId: q.questionId,
      answer: "A",
    });
    expect(evalCorrect.evaluation?.verdict).toBe("correct");

    // Incorrect submission evaluation
    const evalIncorrect = await submitStudentAnswer({
      questionId: q.questionId,
      answer: "B",
    });
    expect(evalIncorrect.evaluation?.verdict).toBe("incorrect");
    expect(evalIncorrect.evaluation?.explanation).toBeDefined();
  });

  // 10. Verified evidence substring match against chunk text
  it("Phase 4.3: verified evidence is physically present in the chunk at stated offsets", async () => {
    const sessionRes = await startTutoringSession({
      documentId: execDocId,
      topic: "Problem Statement",
      goal: "quiz",
    });

    const ev = sessionRes.evidence!;
    expect(ev.status).toBe("verified");
    expect(ev.start).toBeDefined();
    expect(ev.end).toBeDefined();

    // Verify using DefaultEvidenceVerifier against actual indexed chunk
    const db = openDb();
    const chunkRow = db
      .prepare("SELECT id, text FROM chunks WHERE id = ?")
      .get(ev.chunkId) as { id: string; text: string } | undefined;
    db.close();

    const normalise = (t: string) => t.replace(/[\s\r\n\t]+/g, " ").trim().toLowerCase();
    expect(normalise(chunkRow!.text.slice(ev.start!, ev.end!))).toBe(normalise(ev.quote));

    const verifier = new DefaultEvidenceVerifier();
    const chunk: SourceChunk = {
      id: ev.chunkId,
      documentId: execDocId,
      heading: "Problem Statement",
      ordinal: 1,
      text: chunkRow!.text,
    };
    const check = verifier.verify({ chunkId: ev.chunkId, quote: ev.quote }, chunk);
    expect(check.status).toBe("verified");
    expect(check.reference.start).toBe(ev.start);
    expect(check.reference.end).toBe(ev.end);
  });

  // 11. Safe abstention on sparse chunk
  it("Phase 4.4: cleanly abstains when chunk has insufficient content for sound questions", () => {
    const sparseChunk: SourceChunk = {
      id: "sparse_1",
      documentId: "sparse_doc",
      heading: "Overview",
      ordinal: 0,
      text: "Notes page 1.",
    };
    const q = createQuestionForChunk(sparseChunk, "sparse_concept");
    expect(q).toBeNull();
  });

  // 12. Accurate provider reporting
  it("Phase 7.1: accurately reports provider status as deterministic_fallback when LLM is unavailable", async () => {
    const sessionRes = await startTutoringSession({
      documentId: execDocId,
      topic: "Problem Statement",
      goal: "quiz",
    });

    expect(sessionRes.provider).toBe("deterministic_fallback");
  });

  // 13. Ingested documents list includes suggestedTopics
  it("Phase 2.7: listDocuments includes suggestedTopics for all indexed materials", () => {
    const docs = listDocuments();
    const exec = docs.find((d) => d.id === execDocId);
    expect(exec).toBeDefined();
    expect(exec?.suggestedTopics).toBeDefined();
    expect(exec?.suggestedTopics?.length).toBeGreaterThan(0);

    const dbms = docs.find((d) => d.id === dbmsDocId);
    expect(dbms).toBeDefined();
    expect(dbms?.suggestedTopics).toBeDefined();
    expect(dbms?.suggestedTopics?.length).toBeGreaterThan(0);
  });
});
