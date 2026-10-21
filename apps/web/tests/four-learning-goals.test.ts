import { describe, expect, it } from "vitest";
import { startTutoringSession } from "../lib/server/tutoring-policy";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";
import { extractCleanSentences } from "../lib/server/document-service";

describe("Four Distinct Learning Goals & Provider Status Suite", () => {
  it("Goal 1 (Teach): explains source-grounded concept before testing it", async () => {
    const res = await startTutoringSession({
      topic: "2NF",
      goal: "teach",
    });

    expect(res.question).toBeDefined();
    expect(res.message).toContain("Let's study");
    expect(res.message).toContain("core concept");
    expect(res.message).toContain("To check your understanding of this concept, let's explore this question:");
    expect(res.evidence?.status).toBe("verified");
  });

  it("Goal 2 (Quiz): assesses topic with multiple-choice question and verified evidence", async () => {
    const res = await startTutoringSession({
      topic: "1NF",
      goal: "quiz",
    });

    expect(res.question).toBeDefined();
    expect(["multiple_choice", "short_answer"]).toContain(res.question?.kind);
    expect(res.evidence?.status).toBe("verified");
    expect(res.message).toContain("1nf");
  });

  it("Goal 3 (Weak): targets weak concepts or foundational review", async () => {
    const res = await startTutoringSession({
      focus: "weak",
      goal: "weak",
    });

    expect(res.question).toBeDefined();
    expect(res.message).toContain("Targeting weak concept");
    expect(res.evidence?.status).toBe("verified");
  });

  it("Goal 4 (Full Document): initiates full-syllabus or document sequence without literal search failure", async () => {
    const res = await startTutoringSession({
      topic: "full_document",
      goal: "full_document",
    });

    expect(res.question).toBeDefined();
    expect(res.message).toContain("Starting comprehensive full-syllabus review");
    expect(res.message).not.toContain("couldn't find grounded notes for \"full_document\"");
    expect(res.evidence?.status).toBe("verified");
  });

  it("Metadata header lines (Subject:, Purpose:, Author:) are excluded from extracted sentences", () => {
    const rawNote = `
Subject: Database Management Systems.
Purpose: Sample notes for testing DBMS concepts.
Author: Exam Sprint Team.
A relation is in Second Normal Form when it is in 1NF and all non-prime attributes are fully functionally dependent on candidate keys.
Partial functional dependencies must be eliminated to achieve 2NF.
    `.trim();

    const clean = extractCleanSentences(rawNote);
    expect(clean.some((s) => s.toLowerCase().startsWith("subject:"))).toBe(false);
    expect(clean.some((s) => s.toLowerCase().startsWith("purpose:"))).toBe(false);
    expect(clean.some((s) => s.toLowerCase().startsWith("author:"))).toBe(false);
    expect(clean.some((s) => s.includes("Second Normal Form"))).toBe(true);
  });

  it("Provider status accurately reports deterministic_fallback when topic cannot be resolved", async () => {
    const res = await runTutoringOrchestration({
      action: "start_session",
      topic: "Quantum Superposition Gravitons 999",
    });

    expect(res.provider).toBe("deterministic_fallback");
    expect(res.question).toBeUndefined();
    expect(res.message).toContain("couldn't find study notes");
  });
});
