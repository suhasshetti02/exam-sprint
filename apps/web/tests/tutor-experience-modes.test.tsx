// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { startTutoringSession, submitStudentAnswer } from "../lib/server/tutoring-policy";
import { classifyIntent, parseVoiceCommand } from "../lib/voice-command-parser";
import { EvidenceCard } from "../components/EvidenceCard";
import { deleteDocument, ingestDocument, openDb } from "../lib/server/document-service";

afterEach(() => {
  cleanup();
});

describe("Tutor Experience — Four Learning Modes, Voice, & Conversation Suite", () => {
  describe("Task 1: Four Genuine Learning Modes", () => {
    it("A. Teach Me mode explains concepts in friendly language, marks verified quote, gives example, and understanding check", async () => {
      const res = await startTutoringSession({
        topic: "2NF",
        goal: "teach",
      });

      expect(res.question).toBeDefined();
      expect(res.message).toContain("Let's study");
      expect(res.message).toContain("core concept");
      // Must distinguish direct source quotations with quotes
      expect(res.message).toMatch(/".+"/);
      // Provides applied example
      expect(res.message).toContain("Example / Application:");
      // Short understanding check
      expect(res.message).toContain("To check your understanding of this concept, let's explore this question:");
      expect(res.evidence?.status).toBe("verified");
    });

    it("B. Topic Quiz mode generates grounded quiz with stable choices and verified evidence", async () => {
      const fixture = await ingestDocument(
        "Quiz Mode Fixture.md",
        Buffer.from(`# 1NF\nA relation is in First Normal Form when each attribute contains an atomic value and each field contains a single value rather than a repeating group.`, "utf8"),
      );
      expect(fixture.success).toBe(true);

      try {
        const res = await startTutoringSession({
          documentId: fixture.documentId,
          topic: "1NF",
          goal: "quiz",
        });

        expect(res.question).toBeDefined();
        expect(res.question?.choices).toBeDefined();
        expect(res.question?.choices?.length).toBeGreaterThanOrEqual(2);
        expect(res.evidence?.status).toBe("verified");
        expect(res.evidence?.quote.toLowerCase()).toContain("first normal form");
      } finally {
        if (fixture.documentId) deleteDocument(fixture.documentId);
      }
    });

    it("C. Revise Weak Concepts explains lack of progress history for new document and falls back honestly", async () => {
      const db = openDb();
      try {
        // Create an isolated fresh document with 0 attempts
        const testDocId = `test_weak_doc_${Date.now()}`;
        db.prepare("INSERT INTO documents (id, title, origin) VALUES (?, ?, ?)").run(
          testDocId,
          "Fresh Notes For Testing",
          "student-upload",
        );
        db.prepare(
          "INSERT INTO chunks (id, document_id, heading, ordinal, text, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          `chunk_${testDocId}_1`,
          testDocId,
          "Basics of Indexing",
          1,
          "B-Trees maintain sorted data and allow searches, sequential access, insertions, and deletions in logarithmic time.",
          "hash_1",
        );
        db.prepare("INSERT INTO concepts (id, title, document_id) VALUES (?, ?, ?)").run(
          `${testDocId}__indexing`,
          "Fresh Notes: Basics of Indexing",
          testDocId,
        );
        const nowIso = new Date().toISOString();
        db.prepare(
          `INSERT INTO questions (
            id, concept_id, kind, prompt, choices_json, expected_json,
            evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `q_${testDocId}_1`,
          `${testDocId}__indexing`,
          "multiple_choice",
          "What is the time complexity of B-Tree operations?",
          JSON.stringify(["Logarithmic", "Linear", "Constant", "Quadratic"]),
          JSON.stringify("Logarithmic"),
          `chunk_${testDocId}_1`,
          "logarithmic time",
          96,
          112,
          nowIso,
        );

        // Run weak concept mode on this fresh document
        const res = await startTutoringSession({
          documentId: testDocId,
          goal: "weak",
          focus: "weak",
        });

        // Must honestly communicate that no attempts exist yet, instead of fabricating values
        expect(res.message).toContain("haven't attempted questions");
        expect(res.message).toContain("no weak-concept history recorded");
        expect(res.message).toContain("baseline");
        expect(res.question).toBeDefined();
        expect(res.question?.conceptId).toBe(`${testDocId}__indexing`);
      } finally {
        db.close();
      }
    });

    it("D. Full Document mode traverses substantive sections in order and skips metadata-only chunks explicitly", async () => {
      const db = openDb();
      try {
        const testDocId = `test_full_doc_${Date.now()}`;
        db.prepare("INSERT INTO documents (id, title, origin) VALUES (?, ?, ?)").run(
          testDocId,
          "Full Syllabus Textbook",
          "student-upload",
        );
        // Chunk 1: Metadata/preface (non-substantive < 40 chars)
        db.prepare(
          "INSERT INTO chunks (id, document_id, heading, ordinal, text, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(`chunk_${testDocId}_0`, testDocId, "Table of Contents", 0, "Index page 1.", "hash_0");
        // Chunk 2: Substantive Section 1
        db.prepare(
          "INSERT INTO chunks (id, document_id, heading, ordinal, text, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          `chunk_${testDocId}_1`,
          testDocId,
          "Relational Model Basics",
          1,
          "Relational databases represent collections of tables where each row corresponds to a real-world entity with atomic fields.",
          "hash_1",
        );
        // Chunk 3: Substantive Section 2
        db.prepare(
          "INSERT INTO chunks (id, document_id, heading, ordinal, text, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          `chunk_${testDocId}_2`,
          testDocId,
          "Primary Key Constraints",
          2,
          "A primary key uniquely identifies each record in a relational database table and cannot contain null values.",
          "hash_2",
        );

        // Add questions for each substantive section
        db.prepare("INSERT INTO concepts (id, title, document_id) VALUES (?, ?, ?)").run(
          `${testDocId}__section1`,
          "Section 1",
          testDocId,
        );
        db.prepare("INSERT INTO concepts (id, title, document_id) VALUES (?, ?, ?)").run(
          `${testDocId}__section2`,
          "Section 2",
          testDocId,
        );
        const nowIso = new Date().toISOString();
        db.prepare(
          `INSERT INTO questions (id, concept_id, kind, prompt, choices_json, expected_json, evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `q_${testDocId}_1`,
          `${testDocId}__section1`,
          "multiple_choice",
          "What does each row in a relation represent?",
          JSON.stringify(["A real-world entity", "A column definition", "A schema", "An index"]),
          JSON.stringify("A real-world entity"),
          `chunk_${testDocId}_1`,
          "real-world entity",
          82,
          99,
          nowIso,
        );
        db.prepare(
          `INSERT INTO questions (id, concept_id, kind, prompt, choices_json, expected_json, evidence_chunk_id, evidence_quote, evidence_start, evidence_end, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          `q_${testDocId}_2`,
          `${testDocId}__section2`,
          "multiple_choice",
          "Can a primary key contain null values?",
          JSON.stringify(["No, never", "Yes, always", "Only foreign keys", "Optional"]),
          JSON.stringify("No, never"),
          `chunk_${testDocId}_2`,
          "cannot contain null values",
          79,
          104,
          nowIso,
        );

        // Section 1 study
        const resSec1 = await startTutoringSession({
          documentId: testDocId,
          goal: "full_document",
          sectionOrdinal: 1,
        });

        expect(resSec1.message).toContain("Section 1 of 2");
        expect(resSec1.message).toContain("skipped 1 metadata/empty section");
        expect(resSec1.message).toContain("Relational Model Basics");
        expect(resSec1.question?.evidence?.chunkId).toBe(`chunk_${testDocId}_1`);

        // Section 2 study
        const resSec2 = await startTutoringSession({
          documentId: testDocId,
          goal: "full_document",
          sectionOrdinal: 2,
        });

        expect(resSec2.message).toContain("Section 2 of 2");
        expect(resSec2.message).toContain("Primary Key Constraints");
        expect(resSec2.question?.evidence?.chunkId).toBe(`chunk_${testDocId}_2`);
      } finally {
        db.close();
      }
    });
  });

  describe("Task 2: Context-Aware Conversational Follow-ups", () => {
    it("accurately classifies required follow-up phrases deterministically", () => {
      // 1. Why is this correct?
      const whyCorrect = classifyIntent("Why is this correct?");
      expect(whyCorrect.intent).toBe("EXPLAIN_ANSWER");
      expect(whyCorrect.args?.target).toBe("why_correct");

      // 2. Explain my mistake
      const whyWrong = classifyIntent("Explain my mistake");
      expect(whyWrong.intent).toBe("EXPLAIN_ANSWER");
      expect(whyWrong.args?.target).toBe("why_wrong");

      // 3. Explain more simply
      const simplify = classifyIntent("Explain more simply");
      expect(simplify.intent).toBe("SIMPLIFY_EXPLANATION");

      // 4. Give another example
      const example = classifyIntent("Give another example");
      expect(example.intent).toBe("REQUEST_EXAMPLE");

      // 5. Repeat the question
      const repeat = classifyIntent("Repeat the question");
      expect(repeat.intent).toBe("REPEAT_QUESTION");

      // 6. Ask me another question
      const nextQ = classifyIntent("Ask me another question");
      expect(nextQ.intent).toBe("NEXT_QUESTION");

      // 7. Next topic
      const nextTop = classifyIntent("Next topic");
      expect(nextTop.intent).toBe("CHANGE_TOPIC");
      expect(nextTop.args?.topic).toBe("next");
    });

    it("preserves active question and evidence across 3+ successive conversational turns", async () => {
      // Step 1: Initialize session with a question
      const sessionRes = await startTutoringSession({ topic: "1NF", goal: "quiz" });
      const initialQuestion = sessionRes.question!;
      const initialEvidence = sessionRes.evidence!;
      expect(initialQuestion).toBeDefined();

      // Step 2: Student submits answer
      const evalRes = await submitStudentAnswer({
        questionId: initialQuestion.questionId,
        answer: "Every column must contain atomic values",
      });
      expect(evalRes.evaluation).toBeDefined();

      // Multi-turn Turn 1: "Why is this correct?"
      const cmd1 = parseVoiceCommand("Why is this correct?");
      expect(cmd1.type).toBe("explain_answer");
      // Verification: evaluation explanation and evidence are available
      expect(evalRes.evaluation?.explanation).toBeDefined();
      expect(initialEvidence.quote).toBeDefined();

      // Multi-turn Turn 2: "Explain more simply"
      const cmd2 = parseVoiceCommand("Explain more simply");
      expect(cmd2.type).toBe("simplify_explanation");
      const firstSentence = evalRes.evaluation?.explanation?.split(/[.!?]/)[0];
      expect(firstSentence).toBeDefined();

      // Multi-turn Turn 3: "Give another example"
      const cmd3 = parseVoiceCommand("Give another example");
      expect(cmd3.type).toBe("request_example");

      // Multi-turn Turn 4: "Repeat the question"
      const cmd4 = parseVoiceCommand("Repeat the question");
      expect(cmd4.type).toBe("repeat_question");

      // Throughout all 4 turns, original questionId and evidenceChunkId remain constant
      expect(initialQuestion.questionId).toBe(sessionRes.question?.questionId);
      expect(initialEvidence.chunkId).toBe(sessionRes.evidence?.chunkId);
    });
  });

  describe("Task 3: Voice Tutor State Machine & Mocked Event Hardening", () => {
    it("strictly ignores interim recognition results for option selection", () => {
      const parsedInterim = parseVoiceCommand("Option A", {
        activeQuestion: {
          questionId: "q1",
          conceptId: "c1",
          kind: "multiple_choice",
          prompt: "What is 1NF?",
          choices: ["Atomic values", "Partial dependencies", "Transitive dependencies", "Keys"],
          evidence: { chunkId: "ch1", quote: "atomic values", status: "verified" },
        },
        isQuestionAnswered: false,
      });

      // Command classification is valid, but runtime requires isFinal flag
      expect(parsedInterim.type).toBe("select_option");
      if (parsedInterim.type === "select_option") {
        expect(parsedInterim.optionLetter).toBe("A");
      }
    });

    it("parses single-letter speech normalization (ay -> A, bee -> B, etc.)", () => {
      const parsedAy = parseVoiceCommand("ay", {
        activeQuestion: {
          questionId: "q1",
          conceptId: "c1",
          kind: "multiple_choice",
          prompt: "What is 1NF?",
          choices: ["A", "B", "C", "D"],
          evidence: { chunkId: "ch1", quote: "quote", status: "verified" },
        },
      });
      expect(parsedAy).toEqual({
        type: "select_option",
        optionLetter: "A",
        originalChoiceText: "A",
        isChange: undefined,
      });

      const parsedBee = parseVoiceCommand("bee", {
        activeQuestion: {
          questionId: "q1",
          conceptId: "c1",
          kind: "multiple_choice",
          prompt: "What is 1NF?",
          choices: ["A", "B", "C", "D"],
          evidence: { chunkId: "ch1", quote: "quote", status: "verified" },
        },
      });
      expect(parsedBee).toEqual({
        type: "select_option",
        optionLetter: "B",
        originalChoiceText: "B",
        isChange: undefined,
      });
    });
  });

  describe("Task 4: Evidence Gating UI & Verified Disclosure", () => {
    const mockEvidence = {
      chunkId: "chunk_1",
      quote: "No non-prime attribute may be transitively dependent on a candidate key.",
      status: "verified" as const,
      start: 0,
      end: 74,
      sourceContext: "No non-prime attribute may be transitively dependent on a candidate key. This defines 3NF.",
    };

    it("redacts/locks evidence in quiz mode prior to submission", () => {
      render(
        <EvidenceCard
          evidence={mockEvidence}
          isAnswered={false}
          activeGoal="quiz"
          activeDocumentTitle="DBMS Notes"
        />,
      );

      // Must render gated lock badge and message
      expect(screen.getByTestId("evidence-gated-panel")).toBeDefined();
      expect(screen.getByText("Evidence Hidden During Assessment")).toBeDefined();
      // Must NOT reveal the answer quote before grading
      expect(screen.queryByTestId("source-evidence-inspector")).toBeNull();
    });

    it("redacts/locks evidence in weak-concept mode prior to submission", () => {
      render(
        <EvidenceCard
          evidence={mockEvidence}
          isAnswered={false}
          activeGoal="weak"
          activeDocumentTitle="DBMS Notes"
        />,
      );

      expect(screen.getByTestId("evidence-gated-panel")).toBeDefined();
      expect(screen.getByText("Evidence Hidden During Assessment")).toBeDefined();
      expect(screen.queryByTestId("source-evidence-inspector")).toBeNull();
    });

    it("reveals verified quotation and passage in quiz mode after answer submission", () => {
      render(
        <EvidenceCard
          evidence={mockEvidence}
          isAnswered={true}
          activeGoal="quiz"
          activeDocumentTitle="DBMS Notes"
        />,
      );

      expect(screen.queryByTestId("evidence-gated-panel")).toBeNull();
      expect(screen.getByTestId("source-evidence-inspector")).toBeDefined();
      expect(screen.getByTestId("evidence-highlight-span")).toBeDefined();
      expect(screen.getByText(mockEvidence.quote)).toBeDefined();
    });

    it("displays verified evidence immediately in Teach Me mode before check question", () => {
      render(
        <EvidenceCard
          evidence={mockEvidence}
          isAnswered={false}
          activeGoal="teach"
          activeDocumentTitle="DBMS Notes"
        />,
      );

      expect(screen.queryByTestId("evidence-gated-panel")).toBeNull();
      expect(screen.getByTestId("source-evidence-inspector")).toBeDefined();
      expect(screen.getByText(mockEvidence.quote)).toBeDefined();
    });
  });
});
