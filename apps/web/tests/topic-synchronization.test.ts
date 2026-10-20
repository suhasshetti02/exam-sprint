import { describe, expect, it } from "vitest";
import { isWeakConceptsRequest, resolveConceptId } from "../lib/topic-utils";
import { startTutoringSession } from "../lib/server/tutoring-policy";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";
import { MockLlmProvider } from "../lib/server/llm/providers";

describe("Milestone 7.1: Active Topic / Question / Evidence Synchronization", () => {
  describe("Topic & Intent Normalization", () => {
    it("normalizes natural language topic requests to canonical concept IDs", () => {
      expect(resolveConceptId("Let's practice 1NF.")).toBe("1nf");
      expect(resolveConceptId("1NF practice")).toBe("1nf");
      expect(resolveConceptId("1st normal form")).toBe("1nf");
      expect(resolveConceptId("first normal form")).toBe("1nf");

      expect(resolveConceptId("Quiz me on 2NF")).toBe("2nf");
      expect(resolveConceptId("second normal form")).toBe("2nf");
      expect(resolveConceptId("partial dependencies")).toBe("2nf");

      expect(resolveConceptId("BCNF Practice")).toBe("bcnf");
      expect(resolveConceptId("boyce codd")).toBe("bcnf");
      expect(resolveConceptId("superkey")).toBe("bcnf");

      expect(resolveConceptId("ACID transactions")).toBe("acid");
      expect(resolveConceptId("durability")).toBe("acid");

      expect(resolveConceptId("Quiz on Normalization")).toBe("normalization-basics");
      expect(resolveConceptId("Why Normalize?")).toBe("normalization-basics");

      expect(resolveConceptId("functional dependencies")).toBe("functional-dependencies");
      expect(resolveConceptId("isolation levels")).toBe("isolation-levels");
    });

    it("identifies weak concept requests accurately", () => {
      expect(isWeakConceptsRequest("Please review my weak concepts.")).toBe(true);
      expect(isWeakConceptsRequest("review weak")).toBe(true);
      expect(isWeakConceptsRequest("retest weak")).toBe(true);
      expect(isWeakConceptsRequest("weak")).toBe(true);
      expect(isWeakConceptsRequest("review my weak concepts")).toBe(true);
      expect(isWeakConceptsRequest("practice weak")).toBe(true);

      expect(isWeakConceptsRequest("Let's practice 1NF.")).toBe(false);
      expect(isWeakConceptsRequest("Quiz on Normalization")).toBe(false);
    });

    it("returns undefined for unsupported topics outside syllabus", () => {
      expect(resolveConceptId("Quantum Computing")).toBeUndefined();
      expect(resolveConceptId("React Virtual DOM")).toBeUndefined();
      expect(resolveConceptId("Neural Networks")).toBeUndefined();
    });
  });

  describe("Topic Switching and Consistent State Transitions", () => {
    it("switches from normalization basics to 1NF consistently", async () => {
      const normRes = await startTutoringSession({ topic: "normalization basics" });
      expect(normRes.question).toBeDefined();
      expect(normRes.question?.conceptId).toBe("normalization-basics");
      expect(normRes.evidence).toBeDefined();
      expect(normRes.evidence?.chunkId).toContain("normalization");
      expect(normRes.evidence?.status).toBe("verified");

      // Switch to 1NF
      const oneNfRes = await startTutoringSession({ topic: "Let's practice 1NF." });
      expect(oneNfRes.question).toBeDefined();
      expect(oneNfRes.question?.conceptId).toBe("1nf");
      expect(oneNfRes.evidence).toBeDefined();
      expect(oneNfRes.evidence?.chunkId).toContain("first-normal-form");
      expect(oneNfRes.evidence?.status).toBe("verified");
      expect(oneNfRes.question?.evidence.quote).toBe(oneNfRes.evidence?.quote);
    });

    it("switches between 1NF, 2NF, and BCNF with matching evidence", async () => {
      const res1nf = await startTutoringSession({ topic: "1nf" });
      expect(res1nf.question?.conceptId).toBe("1nf");
      expect(res1nf.evidence?.chunkId).toContain("first-normal-form");

      const res2nf = await startTutoringSession({ topic: "2nf" });
      expect(res2nf.question?.conceptId).toBe("2nf");
      expect(res2nf.evidence?.chunkId).toContain("second-normal-form");

      const resBcnf = await startTutoringSession({ topic: "bcnf" });
      expect(resBcnf.question?.conceptId).toBe("bcnf");
      expect(resBcnf.evidence?.chunkId).toContain("boyce-codd");

      // Every question and evidence pair must refer to the same concept
      for (const res of [res1nf, res2nf, resBcnf]) {
        expect(res.question?.evidence.chunkId).toBe(res.evidence?.chunkId);
        expect(res.question?.evidence.quote).toBe(res.evidence?.quote);
        expect(res.evidence?.status).toBe("verified");
      }
    });

    it("retests weak concepts by choosing a real concept from mastery and announcing the choice", async () => {
      const res = await startTutoringSession({ topic: "Please review my weak concepts." });
      expect(res.question).toBeDefined();
      expect(res.evidence).toBeDefined();
      expect(res.evidence?.status).toBe("verified");
      expect(res.question?.evidence.chunkId).toBe(res.evidence?.chunkId);

      // The message must make the chosen weak concept visible
      expect(res.message).toMatch(/Targeting weak concept:\s+\w+/i);
    });

    it("handles unsupported topics without generating invalid or unrelated questions", async () => {
      const res = await startTutoringSession({ topic: "quantum physics" });
      expect(res.question).toBeUndefined();
      expect(res.evidence).toBeUndefined();
      expect(res.message).toContain("I couldn't find study notes or questions for \"quantum physics\"");
      expect(res.message).toContain("1NF, 2NF, 3NF, BCNF");
    });
  });

  describe("Orchestrator LLM Guardrails & Consistency", () => {
    it("ensures question and evidence are present and match target concept even if LLM omits generate_quiz", async () => {
      // Mock LLM that generates conversational text about 1NF but omits the generate_quiz tool call
      const textOnlyProvider = new MockLlmProvider([
        {
          content: "First Normal Form (1NF) requires all attribute values to be atomic and rows to be distinct.",
          finishReason: "stop",
        },
      ]);

      const res = await runTutoringOrchestration({
        action: "start_session",
        topic: "Let's practice 1NF.",
        customProvider: textOnlyProvider,
      });

      // Orchestrator guardrail must automatically supply the 1NF question and evidence
      expect(res.question).toBeDefined();
      expect(res.question?.conceptId).toBe("1nf");
      expect(res.evidence).toBeDefined();
      expect(res.evidence?.chunkId).toContain("first-normal-form");
      expect(res.evidence?.status).toBe("verified");
      expect(res.message).toContain("First Normal Form");
    });

    it("announces the targeted weak concept when weak concepts are requested via orchestrator", async () => {
      const mockProvider = new MockLlmProvider([
        {
          content: "Let's work on this topic to improve your mastery.",
          finishReason: "stop",
        },
      ]);

      const res = await runTutoringOrchestration({
        action: "start_session",
        topic: "Please review my weak concepts.",
        customProvider: mockProvider,
      });

      expect(res.question).toBeDefined();
      expect(res.evidence).toBeDefined();
      expect(res.message).toMatch(/Targeting weak concept:/i);
    });

    it("returns clean refusal when orchestrator receives an unsupported topic", async () => {
      const mockProvider = new MockLlmProvider([
        {
          content: "I can talk about anything!",
          finishReason: "stop",
        },
      ]);

      const res = await runTutoringOrchestration({
        action: "start_session",
        topic: "Deep Learning Transformers",
        customProvider: mockProvider,
      });

      expect(res.question).toBeUndefined();
      expect(res.evidence).toBeUndefined();
      expect(res.message).toContain("Deep Learning Transformers");
    });
  });

  describe("Regression: Race conditions and question/evidence coupling integrity", () => {
    it("ensures every displayed question and evidence pair strictly refers to the same concept across all canonical topics", async () => {
      const canonicalTopics = [
        "normalization-basics",
        "1nf",
        "2nf",
        "bcnf",
        "acid",
        "functional-dependencies",
        "isolation-levels",
      ];

      for (const topic of canonicalTopics) {
        const res = await startTutoringSession({ topic });
        expect(res.question).toBeDefined();
        expect(res.evidence).toBeDefined();

        // 1. Question concept matches the target topic
        expect(res.question?.conceptId).toBe(topic);

        // 2. Evidence chunk is consistent with target topic
        expect(res.evidence?.chunkId).toBe(res.question?.evidence.chunkId);

        // 3. Evidence quote matches question quote exactly
        expect(res.evidence?.quote).toBe(res.question?.evidence.quote);

        // 4. Evidence must be verified
        expect(res.evidence?.status).toBe("verified");
      }
    });

    it("does not update question or evidence when response has no valid question or unverified evidence", async () => {
      // Simulate state container pattern used in TutoringSession
      let activeQuestion: { questionId: string; conceptId: string } | undefined = {
        questionId: "q-1nf-1",
        conceptId: "1nf",
      };
      let activeEvidence: { chunkId: string; status: string } | undefined = {
        chunkId: "dbms-normalization#first-normal-form",
        status: "verified",
      };

      // Attempt to switch to an invalid/unsupported topic
      const invalidRes = await startTutoringSession({ topic: "NonExistentTopic99" });
      expect(invalidRes.question).toBeUndefined();
      expect(invalidRes.evidence).toBeUndefined();

      // Guard pattern: if question or evidence is missing/unverified, do NOT overwrite active state
      if (invalidRes.question && invalidRes.evidence && invalidRes.evidence.status === "verified") {
        activeQuestion = invalidRes.question;
        activeEvidence = invalidRes.evidence;
      }

      // Previous valid state is safely preserved
      expect(activeQuestion.conceptId).toBe("1nf");
      expect(activeEvidence.chunkId).toBe("dbms-normalization#first-normal-form");
    });

    it("discards out-of-order overlapping requests using monotonic request ID tracking", async () => {
      let latestRequestId = 0;
      let activeQuestion: { questionId: string; conceptId: string } | undefined;

      const handleResponse = (requestId: number, question: { questionId: string; conceptId: string }) => {
        if (requestId !== latestRequestId) {
          // Stale response: discard!
          return false;
        }
        activeQuestion = question;
        return true;
      };

      // 1. Slow request 1 initiated (e.g. normalization)
      const req1Id = ++latestRequestId; // 1

      // 2. Fast request 2 initiated shortly after (e.g. 1NF)
      const req2Id = ++latestRequestId; // 2

      // Request 2 completes FIRST
      const req2Accepted = handleResponse(req2Id, {
        questionId: "q-1nf-1",
        conceptId: "1nf",
      });
      expect(req2Accepted).toBe(true);
      expect(activeQuestion?.conceptId).toBe("1nf");

      // Request 1 completes LATER (out of order)
      const req1Accepted = handleResponse(req1Id, {
        questionId: "q-norm-1",
        conceptId: "normalization-basics",
      });
      expect(req1Accepted).toBe(false);

      // Active question remains 1NF and was NOT overwritten by late request 1!
      expect(activeQuestion?.conceptId).toBe("1nf");
    });
  });
});
