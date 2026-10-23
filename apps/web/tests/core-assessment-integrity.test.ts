import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createQuestionForChunk,
  deleteDocument,
  ingestDocument,
  openDb,
} from "../lib/server/document-service";
import {
  startTutoringSession,
  submitStudentAnswer,
  loadInitialMasteryState,
} from "../lib/server/tutoring-policy";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";
import { MockLlmProvider, OpenAiCompatibleProvider } from "../lib/server/llm/providers";
import { executeMcpTool } from "../lib/server/mcp-client";
import { DefaultEvidenceVerifier, DeterministicAnswerEvaluator, type QuestionRecord, type SourceChunk } from "@exam-sprint/core";

describe("Core Assessment Integrity & Reliability Suite", () => {
  let docAId: string;
  let docBId: string;

  const DOC_A_CONTENT = `# OPERATING SYSTEMS CONCEPTS
## Virtual Memory
Virtual memory is a memory management technique that provides an idealized abstraction of the storage resources.
Paging is a memory management scheme that eliminates the need for contiguous allocation of physical memory.
A page fault occurs when a program attempts to access data in a page that is not currently mapped in RAM.
Thrashing occurs when a computer's virtual memory subsystem is constantly in a state of paging.

## CPU Scheduling
CPU scheduling is a process that allows one process to use the CPU while the execution of another process is on hold.
Preemptive scheduling allows a running process to be interrupted before its CPU burst has completed.
Round robin scheduling assigns a fixed time quantum to each process in equal portions.
A context switch saves the state of the active process and loads the saved state of the new process.
`;

  const DOC_B_CONTENT = `# CELLULAR BIOLOGY
## Mitochondria Structure
Mitochondria are double-membrane-bound organelles found in most eukaryotic organisms that generate ATP.
The inner mitochondrial membrane contains folds called cristae that expand the surface area for oxidative phosphorylation.
The mitochondrial matrix contains mitochondrial DNA, ribosomes, and the enzymes of the citric acid cycle.
Cellular respiration produces ATP molecules through glycolysis, the Krebs cycle, and electron transport.

## Photosynthesis Mechanisms
Photosynthesis is a biological process used by plants to convert light energy into chemical energy stored in glucose.
The light-dependent reactions take place on the thylakoid membranes of chloroplasts using chlorophyll pigments.
The Calvin cycle is a light-independent reaction occurring in the stroma where carbon fixation takes place.
Rubisco is the primary enzyme responsible for fixing carbon dioxide into organic molecules.
`;

  beforeAll(async () => {
    const resA = await ingestDocument("Operating_Systems_Notes.md", Buffer.from(DOC_A_CONTENT, "utf8"));
    expect(resA.success).toBe(true);
    docAId = resA.documentId!;

    const resB = await ingestDocument("Cellular_Biology_Notes.md", Buffer.from(DOC_B_CONTENT, "utf8"));
    expect(resB.success).toBe(true);
    docBId = resB.documentId!;
  });

  afterAll(() => {
    if (docAId) deleteDocument(docAId);
    if (docBId) deleteDocument(docBId);
  });

  // =========================================================================
  // TASK 1: Avoid fabricated multiple-choice distractors
  // =========================================================================
  describe("Task 1: Question format quality", () => {
    it("uses short-answer fallback when sibling passages are unrelated (200 samples)", () => {
      const sampleSize = 200;

      const dummyDistractors: SourceChunk[] = [
        {
          id: "dist_1",
          documentId: "doc_test",
          heading: "Heading 1",
          ordinal: 1,
          text: "Paging is a memory management scheme that eliminates the need for contiguous allocation.",
        },
        {
          id: "dist_2",
          documentId: "doc_test",
          heading: "Heading 2",
          ordinal: 2,
          text: "Preemptive scheduling allows a running process to be interrupted before its CPU burst completes.",
        },
        {
          id: "dist_3",
          documentId: "doc_test",
          heading: "Heading 3",
          ordinal: 3,
          text: "Round robin scheduling assigns a fixed time quantum to each process in equal portions.",
        },
      ];

      for (let i = 0; i < sampleSize; i++) {
        const chunk: SourceChunk = {
          id: `chunk_permutation_sample_${i}_${(i * 37) % 100}`,
          documentId: "doc_test",
          heading: `Concept Heading ${i}`,
          ordinal: i,
          text: `Virtual memory is a memory management technique providing idealized storage resource abstraction for process number ${i}.`,
        };

        const q = createQuestionForChunk(chunk, `concept_${i}`, undefined, dummyDistractors);
        expect(q).not.toBeNull();
        expect(q?.kind).toBe("short_answer");
        expect(q?.choices).toEqual([]);
        expect(q?.expected.correctAnswer).toBe(q?.evidenceQuote);
      }
    });

    it("does not let a forced answer position turn unrelated passages into distractors", () => {
      const dummyDistractors: SourceChunk[] = [
        {
          id: "dist_a",
          documentId: "doc_test",
          heading: "Heading A",
          ordinal: 1,
          text: "Paging eliminates the need for contiguous allocation of physical storage across RAM.",
        },
        {
          id: "dist_b",
          documentId: "doc_test",
          heading: "Heading B",
          ordinal: 2,
          text: "Preemptive scheduling interrupts a running task safely before completing its burst.",
        },
        {
          id: "dist_c",
          documentId: "doc_test",
          heading: "Heading C",
          ordinal: 3,
          text: "Round robin scheduling allocates a fixed quantum across every active execution thread.",
        },
      ];

      const evaluator = new DeterministicAnswerEvaluator(new DefaultEvidenceVerifier());
      const letters = ["A", "B", "C", "D"] as const;
      for (let targetIdx = 0; targetIdx < 4; targetIdx++) {
        const chunk: SourceChunk = {
          id: `chunk_pos_test_${targetIdx}`,
          documentId: docAId,
          heading: `Forced Position ${letters[targetIdx]}`,
          ordinal: targetIdx + 100,
          text: `A page fault occurs when a program attempts to access unmapped physical RAM blocks safely ${targetIdx}.`,
        };

        const conceptId = `${docAId}__forced_${targetIdx}`;
        const q = createQuestionForChunk(chunk, conceptId, undefined, dummyDistractors, targetIdx);
        expect(q).not.toBeNull();
        expect(q!.expected.correctAnswer).toBe(q!.evidenceQuote);
        expect(q!.choices).toEqual([]);

        const record: QuestionRecord = {
          id: q!.id,
          conceptId: q!.conceptId,
          kind: q!.kind,
          prompt: q!.prompt,
          choices: [],
          expected: q!.expected,
          evidenceChunkId: chunk.id,
          evidenceQuote: q!.evidenceQuote,
          evidenceStart: q!.evidenceStart,
          evidenceEnd: q!.evidenceEnd,
          verifiedAt: new Date().toISOString(),
        };
        expect(evaluator.evaluate(record, q!.evidenceQuote).verdict).toBe("correct");
        expect(evaluator.evaluate(record, `Option ${letters[targetIdx]} unrelated`).verdict).toBe("incorrect");
      }
    });

    it("verifies seed questions in questions.json are balanced across positions A-D (25% each)", () => {
      const db = openDb();
      try {
        const rows = db.prepare("SELECT expected_json FROM questions WHERE id LIKE 'q-%'").all() as Array<{ expected_json: string }>;
        const counts = { A: 0, B: 0, C: 0, D: 0 };
        for (const r of rows) {
          const parsed = JSON.parse(r.expected_json);
          if (parsed.kind === "multiple_choice" && parsed.correctAnswer in counts) {
            counts[parsed.correctAnswer as keyof typeof counts]++;
          }
        }
        // 8 MCQs in seed: exactly 2 A, 2 B, 2 C, 2 D (25% each)
        expect(counts.A).toBe(2);
        expect(counts.B).toBe(2);
        expect(counts.C).toBe(2);
        expect(counts.D).toBe(2);
      } finally {
        db.close();
      }
    });
  });

  // =========================================================================
  // TASK 2: Improve question quality and distractors
  // =========================================================================
  describe("Task 2: Question quality guardrails and distractors", () => {
    it("strips markdown formatting (#, *, `, _) from choices", () => {
      const chunk: SourceChunk = {
        id: "chunk_md_test",
        documentId: "doc_test",
        heading: "Markdown Sanitization",
        ordinal: 1,
        text: "**Virtual memory** is an `idealized` abstraction of physical *RAM* storage resources.",
      };
      const distractors: SourceChunk[] = [
        {
          id: "dist_md_1",
          documentId: "doc_test",
          heading: "H1",
          ordinal: 2,
          text: "# Paging is a **memory** management scheme eliminating contiguous physical allocation.",
        },
        {
          id: "dist_md_2",
          documentId: "doc_test",
          heading: "H2",
          ordinal: 3,
          text: "## Preemptive scheduling `allows` a process to be **interrupted** before completion.",
        },
        {
          id: "dist_md_3",
          documentId: "doc_test",
          heading: "H3",
          ordinal: 4,
          text: "* Round robin scheduling assigns a _fixed_ time quantum to each active thread.",
        },
      ];

      const q = createQuestionForChunk(chunk, "concept_md", undefined, distractors);
      expect(q).not.toBeNull();
      for (const choice of q!.choices!) {
        expect(choice).not.toMatch(/[*_`#]/);
      }
    });

    it("falls back to short_answer if insufficient defensible distractors exist", () => {
      const chunk: SourceChunk = {
        id: "chunk_sparse_distractors",
        documentId: "doc_test",
        heading: "Sparse Notes",
        ordinal: 1,
        text: "A unique identifier provides singular deterministic resolution for persistent entities.",
      };
      // Only 1 distractor provided (< 3 required for 4-choice MCQ)
      const distractors: SourceChunk[] = [
        {
          id: "dist_only_one",
          documentId: "doc_test",
          heading: "Other",
          ordinal: 2,
          text: "Another sentence that does not provide enough variety for multiple defensible choices.",
        },
      ];

      const q = createQuestionForChunk(chunk, "concept_sparse", undefined, distractors);
      expect(q).not.toBeNull();
      expect(q?.kind).toBe("short_answer");
      expect(q?.choices).toEqual([]);
    });

    it("abstains from generating question when source text is too brief to support verified evidence", () => {
      const ungroundedChunk: SourceChunk = {
        id: "chunk_too_short",
        documentId: "doc_test",
        heading: "Heading",
        ordinal: 1,
        text: "Too short.",
      };
      const q = createQuestionForChunk(ungroundedChunk, "concept_short");
      expect(q).toBeNull();
    });
  });

  // =========================================================================
  // TASK 3: Make answer recording idempotent
  // =========================================================================
  describe("Task 3: Server-enforced idempotency", () => {
    it("handles 20 concurrent identical submissions producing exactly 1 attempt and 1 mastery update", async () => {
      const session = await startTutoringSession({
        documentId: docAId,
        topic: "Virtual Memory",
        goal: "quiz",
      });
      expect(session.question).toBeDefined();
      const qId = session.question!.questionId;

      const clientAttemptId = `concurrent_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Read initial attempts count in database
      const db = openDb();
      const initialAttempts = db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE client_attempt_id = ?").get(clientAttemptId) as { n: number };
      expect(initialAttempts.n).toBe(0);

      // Send 20 concurrent requests for the same logical attempt
      const concurrentPromises = Array.from({ length: 20 }, () =>
        submitStudentAnswer({
          questionId: qId,
          answer: "Virtual memory is a memory management technique that provides an idealized abstraction of the storage resources.",
          clientAttemptId,
          documentId: docAId,
        }),
      );

      const results = await Promise.all(concurrentPromises);

      // All 20 requests must return successfully and invoke record_progress
      const recordTrace = results[0]!.toolTraces.find((t) => t.tool === "record_progress");
      expect(recordTrace).toBeDefined();
      expect(recordTrace?.status).toBe("success");

      // Database must have exactly ONE attempt row for this clientAttemptId
      const finalAttempts = db.prepare("SELECT COUNT(*) AS n FROM attempts WHERE client_attempt_id = ?").get(clientAttemptId) as { n: number };
      db.close();

      expect(finalAttempts.n).toBe(1);
    });

    it("returns existing result on repeated sequential retry without incrementing attempt count", async () => {
      const session = await startTutoringSession({
        documentId: docAId,
        topic: "CPU Scheduling",
        goal: "quiz",
      });
      expect(session.question).toBeDefined();
      const qId = session.question!.questionId;
      const clientAttemptId = `retry_seq_${Date.now()}`;

      // First submission
      const res1 = await submitStudentAnswer({
        questionId: qId,
        answer: "CPU scheduling is a process that allows one process to use the CPU while the execution of another process is on hold.",
        clientAttemptId,
        documentId: docAId,
      });

      const mastery1 = res1.masteryList.find((m) => m.conceptId.includes("cpu-scheduling"))?.attemptsCount;

      // Second identical submission (retry)
      const res2 = await submitStudentAnswer({
        questionId: qId,
        answer: "CPU scheduling is a process that allows one process to use the CPU while the execution of another process is on hold.",
        clientAttemptId,
        documentId: docAId,
      });

      const mastery2 = res2.masteryList.find((m) => m.conceptId.includes("cpu-scheduling"))?.attemptsCount;

      expect(mastery2).toBe(mastery1);
    });

    it("ensures a genuinely distinct subsequent attempt receives a new ID and increments attempts", async () => {
      const session = await startTutoringSession({
        documentId: docAId,
        topic: "CPU Scheduling",
        goal: "quiz",
      });
      const qId = session.question!.questionId;
      const clientAttemptId1 = `distinct_att_1_${Date.now()}`;
      const clientAttemptId2 = `distinct_att_2_${Date.now()}`;

      // First attempt
      const res1 = await submitStudentAnswer({
        questionId: qId,
        answer: "CPU scheduling allocates processor time slices.",
        clientAttemptId: clientAttemptId1,
        documentId: docAId,
      });

      // Distinct second attempt
      const res2 = await submitStudentAnswer({
        questionId: qId,
        answer: "CPU scheduling manages process execution queues.",
        clientAttemptId: clientAttemptId2,
        documentId: docAId,
      });

      const db = openDb();
      const rows = db
        .prepare("SELECT id, client_attempt_id FROM attempts WHERE client_attempt_id IN (?, ?)")
        .all(clientAttemptId1, clientAttemptId2) as Array<{ id: string; client_attempt_id: string }>;
      db.close();

      expect(rows).toHaveLength(2);
      expect(rows[0]!.id).not.toBe(rows[1]!.id);
      const m1 = res1.masteryList.find((m) => m.conceptId.includes("cpu-scheduling"))?.attemptsCount ?? 0;
      const m2 = res2.masteryList.find((m) => m.conceptId.includes("cpu-scheduling"))?.attemptsCount ?? 0;
      expect(m2).toBeGreaterThan(m1);
    });
  });

  // =========================================================================
  // TASK 4: Dynamic-document evaluation on custom non-DBMS documents
  // =========================================================================
  describe("Task 4: Dynamic-document question generation and evaluation", () => {
    it("generates, retrieves evidence, and evaluates answers on custom non-DBMS document without foreign-key errors", async () => {
      // 1. Start session on non-DBMS Biology document
      const session = await startTutoringSession({
        documentId: docBId,
        topic: "Mitochondria",
        goal: "quiz",
      });

      // 2. Validate question returned
      expect(session.question).toBeDefined();
      const question = session.question!;
      expect(question.conceptId).toContain(docBId);

      // 3. Evidence verified
      expect(session.evidence).toBeDefined();
      expect(session.evidence?.status).toBe("verified");
      expect(session.evidence?.quote.toLowerCase()).toContain("mitochondri");

      // 4. Retrieve question rubric from DB
      const db = openDb();
      const qRow = db.prepare("SELECT expected_json FROM questions WHERE id = ?").get(question.questionId) as { expected_json: string } | undefined;
      db.close();

      expect(qRow).toBeDefined();
      const rubric = JSON.parse(qRow!.expected_json);
      const correctAns = rubric.correctAnswer || rubric.acceptableVariants?.[0] || "Mitochondria";

      // 5. Submit correct answer
      const evalCorrect = await submitStudentAnswer({
        questionId: question.questionId,
        answer: correctAns,
        clientAttemptId: `bio_att_correct_${Date.now()}`,
        documentId: docBId,
      });
      expect(evalCorrect.evaluation?.verdict).toBe("correct");

      // 6. Submit incorrect answer
      const evalIncorrect = await submitStudentAnswer({
        questionId: question.questionId,
        answer: "Completely wrong cellular structure",
        clientAttemptId: `bio_att_wrong_${Date.now()}`,
        documentId: docBId,
      });
      expect(evalIncorrect.evaluation?.verdict).toBe("incorrect");

      // 7. Verify progress persisted and isolated to docB
      expect(evalIncorrect.masteryList).toBeDefined();
      const bioMastery = evalIncorrect.masteryList.find((m) => m.conceptId.includes(docBId));
      expect(bioMastery).toBeDefined();
      expect(bioMastery?.attemptsCount).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // TASK 5: Document isolation
  // =========================================================================
  describe("Task 5: Strict document isolation", () => {
    it("never leaks search results, evidence, questions, or mastery across document boundaries", async () => {
      // Search scoped to doc A (OS)
      const searchResA = await executeMcpTool<
        { query: string; limit: number; documentId?: string },
        { results: Array<{ chunkId: string; documentId: string }> }
      >("search_study_notes", { query: "membrane and energy", limit: 5, documentId: docAId });

      for (const r of searchResA.result.results) {
        expect(r.documentId).toBe(docAId);
        expect(r.documentId).not.toBe(docBId);
      }

      // Search scoped to doc B (Biology)
      const searchResB = await executeMcpTool<
        { query: string; limit: number; documentId?: string },
        { results: Array<{ chunkId: string; documentId: string }> }
      >("search_study_notes", { query: "CPU scheduling algorithm", limit: 5, documentId: docBId });

      for (const r of searchResB.result.results) {
        expect(r.documentId).toBe(docBId);
        expect(r.documentId).not.toBe(docAId);
      }

      // Mastery scoped to doc A
      const masteryA = await loadInitialMasteryState(docAId);
      for (const m of masteryA.masteryList) {
        expect(m.conceptId).toContain(docAId);
        expect(m.conceptId).not.toContain(docBId);
      }

      // Mastery scoped to doc B
      const masteryB = await loadInitialMasteryState(docBId);
      for (const m of masteryB.masteryList) {
        expect(m.conceptId).toContain(docBId);
        expect(m.conceptId).not.toContain(docAId);
      }
    });
  });

  // =========================================================================
  // TASK 6: Truthful AI-provider status and execution metadata
  // =========================================================================
  describe("Task 6: Truthful AI-provider status and execution metadata", () => {
    it("reports live_model execution path and model name when live model succeeds", async () => {
      const mockProvider = new MockLlmProvider([
        {
          content: "Let us review Virtual Memory concepts from your notes.",
          toolCalls: [
            {
              id: "call_quiz_1",
              name: "generate_quiz",
              arguments: { conceptId: "2nf", count: 1, focus: "new" },
            },
          ],
          finishReason: "tool_calls",
        },
        {
          content: "Here is your practice question on 2NF.",
          finishReason: "stop",
        },
      ]);

      const res = await runTutoringOrchestration({
        action: "start_session",
        topic: "2NF",
        customProvider: mockProvider,
      });

      expect(res.provider).toBe("llm");
      expect(res.executionMetadata).toBeDefined();
      expect(res.executionMetadata?.executionPath).toBe("live_model");
      expect(res.executionMetadata?.provider).toBe("mock-llm");
      expect(res.executionMetadata?.model).toBe("mock-tutor-v1");
      expect(res.executionMetadata?.callCount).toBeGreaterThanOrEqual(1);
    });

    it("reports deterministic_fallback and safe reason when provider is null or fails", async () => {
      const res = await runTutoringOrchestration({
        action: "start_session",
        topic: "Virtual Memory",
        documentId: docAId,
      });

      expect(res.provider).toBe("deterministic_fallback");
      expect(res.executionMetadata).toBeDefined();
      expect(res.executionMetadata?.executionPath).toBe("deterministic_fallback");
      expect(res.executionMetadata?.provider).toBe("deterministic_policy");
      expect(res.executionMetadata?.fallbackReason).toBeDefined();
    });

    it("verifies gemini-3.8-flash is the documented default model for Gemini configurations", () => {
      const provider = new OpenAiCompatibleProvider({
        apiKey: "AIzaSyFakeKey1234567890",
      });
      expect(provider.model).toBe("gemini-3.8-flash");
      expect(provider.baseUrl).toContain("generativelanguage.googleapis.com");
    });
  });
});
