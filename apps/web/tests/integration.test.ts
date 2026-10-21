import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "../app/api/session/route";
import type { SessionResponse } from "../lib/api-client";
import { getServerConfig } from "../lib/server/config";

describe("Milestone 3: Server-side Tutoring Integration & Flow", () => {
  let serverInstance: Server | null = null;

  beforeAll(async () => {
    // 1. Check if an isolated test MCP server is already configured and healthy (e.g. from globalSetup)
    const { MCP_SERVER_URL } = getServerConfig();
    try {
      const healthUrl = new URL("/healthz", MCP_SERVER_URL).toString();
      const res = await fetch(healthUrl);
      if (res.ok) return;
    } catch {
      // Server not reachable; start an isolated instance below
    }

    // 2. Standalone execution: start an isolated instance on an ephemeral dynamic port (listen(0))
    // Never silently reuse an arbitrary server on port 3001
    try {
      const { createApp } = await import("../../../apps/mcp-server/src/app");
      const app = createApp();
      serverInstance = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        serverInstance!.once("listening", () => resolve());
        serverInstance!.once("error", (err) => reject(err));
      });
      const addr = serverInstance.address() as AddressInfo;
      if (!addr || typeof addr.port !== "number") {
        throw new Error("Could not determine dynamic port for test MCP server");
      }
      process.env.MCP_SERVER_URL = `http://127.0.0.1:${addr.port}/mcp`;
    } catch (err) {
      throw new Error(`Failed to guarantee isolated MCP test server: ${err}`);
    }
  });

  afterAll(async () => {
    if (serverInstance) {
      await new Promise<void>((resolve) => serverInstance!.close(() => resolve()));
      serverInstance = null;
    }
  });
  it("handles validation errors and malformed bodies safely", async () => {
    // 1. Malformed JSON
    const malformedReq = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const malformedRes = await POST(malformedReq);
    expect(malformedRes.status).toBe(400);
    const malformedBody = (await malformedRes.json()) as { error: string };
    expect(malformedBody.error).toBe("invalid_json");

    // 2. Schema violation (missing required action)
    const invalidReq = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wrongField: 123 }),
    });
    const invalidRes = await POST(invalidReq);
    expect(invalidRes.status).toBe(400);
    const invalidBody = (await invalidRes.json()) as { error: string; issues: unknown[] };
    expect(invalidBody.error).toBe("validation_error");
    expect(Array.isArray(invalidBody.issues)).toBe(true);

    // 3. Invalid submit_answer missing answer text
    const emptyAnswerReq = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit_answer", questionId: "q-1", answer: "" }),
    });
    const emptyAnswerRes = await POST(emptyAnswerReq);
    expect(emptyAnswerRes.status).toBe(400);
  });

  it("step 1: starts revision session on topic '2nf', retrieving notes and generating a question with verified evidence", async () => {
    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_session", topic: "2nf" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionResponse;
    expect(body.question).toBeDefined();
    expect(body.question?.conceptId).toBe("2nf");
    expect(body.question?.prompt).toBeTruthy();

    // Verify verified quotation is present with offsets
    expect(body.evidence).toBeDefined();
    expect(body.evidence?.status).toBe("verified");
    expect(body.evidence?.quote).toBeTruthy();
    expect(typeof body.evidence?.start).toBe("number");
    expect(typeof body.evidence?.end).toBe("number");

    // Verify real tool trace entries were recorded (search_study_notes, get_mastery, generate_quiz)
    expect(body.toolTraces.length).toBeGreaterThanOrEqual(2);
    const toolNames = body.toolTraces.map((t) => t.tool);
    expect(toolNames).toContain("generate_quiz");
    expect(body.toolTraces.every((t) => t.status === "success")).toBe(true);

    expect(body.question?.questionId).toBeTruthy();
  });

  it("step 2: evaluates an incorrect answer with a diagnosed misconception, recording progress in SQLite", async () => {
    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_answer",
        questionId: "q-2nf-1",
        answer: "it eliminates transitive dependencies",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionResponse;
    expect(body.evaluation).toBeDefined();
    expect(body.evaluation?.verdict).toBe("incorrect");
    expect(body.evaluation?.misconceptionLabel).toBe("confuses-2nf-with-3nf");

    // Verify verified source evidence is attached
    expect(body.evidence?.status).toBe("verified");

    // Verify tool traces for evaluate_answer, record_progress, get_mastery
    const toolNames = body.toolTraces.map((t) => t.tool);
    expect(toolNames).toContain("evaluate_answer");
    expect(toolNames).toContain("record_progress");
    expect(toolNames).toContain("get_mastery");

    // Verify mastery list shows 2nf updated
    const concept2nf = body.masteryList.find((m) => m.conceptId === "2nf");
    expect(concept2nf).toBeDefined();
    expect(concept2nf?.attemptsCount).toBeGreaterThanOrEqual(1);
    expect(concept2nf?.openMisconceptions).toContain("confuses-2nf-with-3nf");
  });

  it("step 3: later session retrieves real persisted learner state and selects weak concept for review", async () => {
    // 1. GET request retrieves persisted learning history
    const getRes = await GET();
    expect(getRes.status).toBe(200);

    const getState = (await getRes.json()) as {
      masteryList: Array<{ conceptId: string; mastery: number; openMisconceptions: string[] }>;
    };
    const concept2nf = getState.masteryList.find((m) => m.conceptId === "2nf");
    expect(concept2nf).toBeDefined();
    expect(concept2nf?.openMisconceptions).toContain("confuses-2nf-with-3nf");

    // 2. Request revision focusing on weak concepts
    const reviewReq = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_session", focus: "weak" }),
    });

    const reviewRes = await POST(reviewReq);
    expect(reviewRes.status).toBe(200);

    const reviewBody = (await reviewRes.json()) as SessionResponse;
    expect(["2nf", "normalization-basics"]).toContain(reviewBody.question?.conceptId); // Automatically prioritized weak concept!
    expect(reviewBody.evidence?.status).toBe("verified");
  });

  it("step 4: submits a correct answer, improving mastery and resolving the misconception", async () => {
    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_answer",
        questionId: "q-2nf-1",
        answer: "partial dependencies",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as SessionResponse;
    expect(body.evaluation?.verdict).toBe("correct");

    const concept2nf = body.masteryList.find((m) => m.conceptId === "2nf");
    expect(concept2nf).toBeDefined();
    expect(concept2nf?.mastery).toBeGreaterThan(0);
    // Misconception should now be resolved
    expect(concept2nf?.openMisconceptions).not.toContain("confuses-2nf-with-3nf");
  });

  it("handles invalid question ID safely with structured error", async () => {
    const req = new Request("http://localhost:3000/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit_answer",
        questionId: "non-existent-question-12345",
        answer: "any answer",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("mcp_error");
    expect(body.message).toContain("not found");
  });

  describe("Regression: Topic and Evidence Consistency (Audit Fixes)", () => {
    it("requests BCNF and receives BCNF-aligned question and verified evidence", async () => {
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
      expect(body.evidence?.chunkId).toBe("dbms-normalization#boyce-codd-normal-form");
      expect(body.evidence?.status).toBe("verified");
      expect(body.question?.evidence.chunkId).toBe(body.evidence?.chunkId);
    });

    it("requests ACID immediately after BCNF and receives ACID-aligned question and evidence", async () => {
      const req = new Request("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_session", topic: "ACID" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = (await res.json()) as SessionResponse;
      expect(body.question).toBeDefined();
      expect(body.question?.conceptId).toBe("acid");
      expect(body.evidence).toBeDefined();
      expect(body.evidence?.chunkId).toBe("dbms-transactions#atomicity-and-durability");
      expect(body.evidence?.status).toBe("verified");
      // Explicitly verify it is not stale BCNF or 1NF
      expect(body.question?.conceptId).not.toBe("bcnf");
      expect(body.question?.conceptId).not.toBe("1nf");
    });

    it("submits an answer for the currently displayed question ID and evaluates correctly", async () => {
      // 1. Fetch active question for ACID
      const startReq = new Request("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_session", topic: "ACID" }),
      });
      const startRes = await POST(startReq);
      const startBody = (await startRes.json()) as SessionResponse;
      const activeQ = startBody.question!;
      const activeQId = activeQ.questionId;
      const answer =
        activeQ.kind === "multiple_choice"
          ? "A"
          : "Its changes survive a crash";

      // 2. Submit answer for the exact active question ID
      const submitReq = new Request("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_answer",
          questionId: activeQId,
          answer,
        }),
      });
      const submitRes = await POST(submitReq);
      expect(submitRes.status).toBe(200);

      const submitBody = (await submitRes.json()) as SessionResponse;
      expect(submitBody.evaluation?.verdict).toBe("correct");
      expect(submitBody.evidence?.chunkId).toBe("dbms-transactions#atomicity-and-durability");
      expect(submitBody.evidence?.status).toBe("verified");
    });

    it("produces a safe recoverable message rather than an unrelated question when topic is unsupported", async () => {
      const req = new Request("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_session", topic: "Quantum Mechanics" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = (await res.json()) as SessionResponse;
      // Must NOT silently return an unrelated default question (like 1NF or normalization)
      expect(body.question).toBeUndefined();
      expect(body.evidence).toBeUndefined();
      expect(body.message).toContain("couldn't find study notes");
      expect(body.message).toContain("syllabus topic");
    });

    it("weak-concept retest returns a question and evidence that strictly belong together", async () => {
      const req = new Request("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start_session", focus: "weak" }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const body = (await res.json()) as SessionResponse;
      expect(body.question).toBeDefined();
      expect(body.evidence).toBeDefined();
      expect(body.question?.evidence.chunkId).toBe(body.evidence?.chunkId);
      expect(body.evidence?.status).toBe("verified");
      expect(body.message).toContain(body.question!.conceptId);
    });
  });
});
