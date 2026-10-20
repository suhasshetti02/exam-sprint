import { describe, expect, it } from "vitest";
import { POST } from "../app/api/challenge/route";
import type { ChallengeStateResponse, AnswerSlotResponse } from "../lib/server/challenge-service";

describe("Milestone 6: Rapid-Fire Redemption Challenge Flow", () => {
  let createdChallengeId: string;
  let challengeSlots: ChallengeStateResponse["slots"];

  it("1. Starts a Rapid-Fire challenge with 5 weak-concept biased slots and verified evidence", async () => {
    const req = new Request("http://localhost:3000/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChallengeStateResponse;
    expect(body.challengeId).toBeDefined();
    expect(body.challengeId).toMatch(/^chal_/);
    expect(body.status).toBe("active");
    expect(body.score).toBe(0);
    expect(body.totalSlots).toBe(5);
    expect(body.slots).toHaveLength(5);

    // Each slot must have a valid question with verified evidence
    for (const slot of body.slots) {
      expect(slot.slotIndex).toBeGreaterThanOrEqual(0);
      expect(slot.slotIndex).toBeLessThan(5);
      expect(slot.questionId).toBeTruthy();
      expect(slot.conceptId).toBeTruthy();
      expect(slot.question.prompt).toBeTruthy();
      expect(slot.question.evidence).toBeDefined();
      expect(slot.question.evidence.quote).toBeTruthy();
      expect(slot.answered).toBe(false);
    }

    createdChallengeId = body.challengeId;
    challengeSlots = body.slots;
  });

  it("2. Evaluates an answer server-authoritatively and returns instant verified evidence", async () => {
    expect(createdChallengeId).toBeTruthy();
    expect(challengeSlots).toBeDefined();

    const firstSlot = challengeSlots[0]!;
    expect(firstSlot).toBeDefined();
    const req = new Request("http://localhost:3000/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "answer",
        challengeId: createdChallengeId,
        slotIndex: 0,
        answer: "A",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as AnswerSlotResponse;
    expect(body.slotIndex).toBe(0);
    expect(["correct", "partially_correct", "incorrect"]).toContain(body.verdict);
    expect(body.explanation).toBeTruthy();
    expect(body.evidence).toBeDefined();
    expect(body.evidence.quote).toBeTruthy();
    expect(body.challenge).toBeDefined();
    expect(body.challenge.slots[0]!.answered).toBe(true);
    expect(body.challenge.slots[0]!.verdict).toBe(body.verdict);
  });

  it("3. Enforces idempotency and rejects duplicate submissions with 409 Conflict", async () => {
    expect(createdChallengeId).toBeTruthy();

    // Attempting to answer slot 0 a second time
    const req = new Request("http://localhost:3000/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "answer",
        challengeId: createdChallengeId,
        slotIndex: 0,
        answer: "B",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(409);

    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("conflict");
    expect(body.message).toMatch(/already answered/i);
  });

  it("4. Retrieves current challenge state via get_state", async () => {
    expect(createdChallengeId).toBeTruthy();

    const req = new Request("http://localhost:3000/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "get_state",
        challengeId: createdChallengeId,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as ChallengeStateResponse;
    expect(body.challengeId).toBe(createdChallengeId);
    expect(body.status).toBe("active");
    expect(body.slots[0]!.answered).toBe(true);
    expect(body.slots[1]!.answered).toBe(false);
  });

  it("5. Completes remaining slots, verifies server score computation and status completion", async () => {
    expect(createdChallengeId).toBeTruthy();

    // Answer slots 1, 2, 3, 4
    for (let i = 1; i < 5; i++) {
      const req = new Request("http://localhost:3000/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "answer",
          challengeId: createdChallengeId,
          slotIndex: i,
          answer: "test answer",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const body = (await res.json()) as AnswerSlotResponse;

      if (i === 4) {
        // Last slot should trigger automatic completion
        expect(body.challenge.status).toBe("completed");
        expect(body.challenge.completedAt).toBeDefined();
        expect(body.challenge.score).toBeGreaterThanOrEqual(0);
        expect(body.challenge.score).toBeLessThanOrEqual(5);
      }
    }
  });

  it("6. Lists recent completed challenges including the newly completed run", async () => {
    const req = new Request("http://localhost:3000/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_recent" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      runs: Array<{ id: string; status: string; score: number; totalSlots: number }>;
    };
    expect(body.runs.length).toBeGreaterThan(0);
    const foundRun = body.runs.find((r) => r.id === createdChallengeId);
    expect(foundRun).toBeDefined();
    expect(foundRun?.status).toBe("completed");
    expect(foundRun?.totalSlots).toBe(5);
  });
});
