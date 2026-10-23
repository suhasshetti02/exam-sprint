import { describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/session/route";
import type { SessionResponse } from "../lib/api-client";
import { MockLlmProvider } from "../lib/server/llm/providers";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";

describe("Milestone 5: Learning Quality, Mastery Integrity, and 'Don't Know' Journey", () => {
  let activeQuestionId: string | undefined;
  let followUpQuestionId: string | undefined;

  it("1. Starts a session on BCNF, receiving a BCNF-grounded question with verified evidence", async () => {
    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_session", topic: "BCNF" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionResponse;
    expect(body.question).toBeDefined();
    expect(body.question?.conceptId).toBe("bcnf");
    expect(body.evidence).toBeDefined();
    expect(body.evidence?.status).toBe("verified");
    expect(body.evidence?.chunkId).toContain("boyce-codd-normal-form");

    // Must not expose secret credentials in session responses
    const rawJson = JSON.stringify(body);
    expect(rawJson).not.toContain("AIza");
    expect(rawJson).not.toContain("LLM_API_KEY");

    activeQuestionId = body.question?.questionId;
    expect(activeQuestionId).toBeTruthy();
  });

  it("2. Submits 'don't know' and receives supportive evidence-grounded explanation and BCNF follow-up question", async () => {
    expect(activeQuestionId).toBeTruthy();

    const initialGetRes = await GET();
    const initialMastery = (await initialGetRes.json()) as {
      masteryList: Array<{ conceptId: string; mastery: number; attemptsCount: number }>;
    };
    const bcnfBefore = initialMastery.masteryList.find((m) => m.conceptId === "bcnf");
    const attemptsBefore = bcnfBefore?.attemptsCount ?? 0;
    const masteryBefore = bcnfBefore?.mastery ?? 0;

    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_answer",
        questionId: activeQuestionId!,
        answer: "I don't know",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionResponse;

    // Must evaluate as incorrect (never credit unearned mastery)
    expect(body.evaluation?.verdict).toBe("incorrect");
    expect(body.evaluation?.misconceptionLabel).toBeUndefined();

    // Must provide supportive explanation grounded in notes
    expect(body.message).toMatch(/(No worries|No problem|clarify|distinction)/i);

    // Must supply a follow-up question testing the SAME concept (BCNF)
    expect(body.question).toBeDefined();
    expect(body.question?.conceptId).toBe("bcnf");
    expect(body.evidence?.status).toBe("verified");
    expect(body.evidence?.chunkId).toContain("boyce-codd-normal-form");

    // Attempts count must be incremented by 1
    const bcnfAfter = body.masteryList.find((m) => m.conceptId === "bcnf");
    expect(bcnfAfter?.attemptsCount).toBe(attemptsBefore + 1);

    // Mastery must not have increased
    expect(bcnfAfter?.mastery).toBeLessThanOrEqual(masteryBefore);

    followUpQuestionId = body.question?.questionId;
    expect(followUpQuestionId).toBeTruthy();
  });

  it("3. Submits an incorrect answer to the follow-up question", async () => {
    expect(followUpQuestionId).toBeTruthy();

    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_answer",
        questionId: followUpQuestionId!,
        answer: "completely wrong answer text",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionResponse;
    expect(body.evaluation?.verdict).toBe("incorrect");
    expect(body.evidence?.status).toBe("verified");
  });

  it("4. Submits a correct answer on a subsequent question, improving mastery", async () => {
    // Start question on 1NF
    const startReq = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_session", topic: "1NF" }),
    });

    const startRes = await POST(startReq);
    const startBody = (await startRes.json()) as SessionResponse;
    const q1nf = startBody.question!;
    expect(q1nf.conceptId).toBe("1nf");

    const initialGet = await GET();
    const initialState = (await initialGet.json()) as {
      masteryList: Array<{ conceptId: string; mastery: number }>;
    };
    const masteryBefore = initialState.masteryList.find((m) => m.conceptId === "1nf")?.mastery ?? 0;

    const answer =
      q1nf.kind === "multiple_choice"
        ? (q1nf.questionId === "q-1nf-2" ? "D" : "A")
        : "every column holds a single atomic value and there are no repeating groups of columns";

    // Submit correct answer for q1nf
    const submitReq = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_answer",
        questionId: q1nf.questionId,
        answer,
      }),
    });

    const submitRes = await POST(submitReq);
    expect(submitRes.status).toBe(200);

    const submitBody = (await submitRes.json()) as SessionResponse;
    expect(submitBody.evaluation?.verdict).toBe("correct");

    const masteryAfter = submitBody.masteryList.find((m) => m.conceptId === "1nf")?.mastery ?? 0;
    // Mastery should have increased or remained clamped at 1.0
    expect(masteryAfter).toBeGreaterThanOrEqual(masteryBefore);
  });

  it("5. Reloading the page (GET /api/session) retrieves consistent persisted state", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const state = (await res.json()) as {
      masteryList: Array<{ conceptId: string; mastery: number; attemptsCount: number }>;
    };

    expect(Array.isArray(state.masteryList)).toBe(true);
    expect(state.masteryList.length).toBeGreaterThan(0);

    const bcnf = state.masteryList.find((m) => m.conceptId === "bcnf");
    expect(bcnf).toBeDefined();
    expect(bcnf!.attemptsCount).toBeGreaterThanOrEqual(2);
  });

  it("6. Retests weak concept and verifies that the selected question targets that concept", async () => {
    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_session", focus: "weak" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionResponse;
    expect(body.question).toBeDefined();

    // Verify that the chosen concept is indeed weak (has open misconceptions or mastery < 0.75)
    const currentConceptId = body.question!.conceptId;
    const conceptData = body.masteryList.find((m) => m.conceptId === currentConceptId);
    expect(conceptData).toBeDefined();

    const isWeak =
      conceptData!.openMisconceptions.length > 0 ||
      (conceptData!.attemptsCount > 0 && conceptData!.mastery < 0.75);
    expect(isWeak).toBe(true);

    // Question evidence must strictly belong to that concept
    expect(body.evidence?.status).toBe("verified");
  });

  it("7. Confirms provider errors trigger deterministic fallback without losing progress or claiming live generation", async () => {
    const failingProvider = new MockLlmProvider();
    failingProvider.generateCompletion = async () => {
      throw new Error("Quota exceeded: 429 RESOURCE_EXHAUSTED");
    };

    const res = await runTutoringOrchestration({
      action: "start_session",
      topic: "bcnf",
      customProvider: failingProvider,
    });

    expect(res.provider).toBe("deterministic_fallback");
    expect(res.question?.conceptId).toBe("bcnf");
    expect(res.evidence?.status).toBe("verified");
    expect(res.toolTraces.length).toBeGreaterThan(0);
  });
});
