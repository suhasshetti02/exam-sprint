import { describe, expect, it } from "vitest";
import {
  TOOL_NAMES,
  evaluateAnswerInput,
  generateQuizInput,
  searchStudyNotesInput,
} from "../src";

describe("tool input schemas", () => {
  it("applies defaults", () => {
    expect(searchStudyNotesInput.parse({ query: "bcnf" }).limit).toBe(5);
    expect(generateQuizInput.parse({ conceptId: "bcnf" })).toMatchObject({ count: 1, focus: "new" });
  });

  it("rejects out-of-range and empty input", () => {
    expect(searchStudyNotesInput.safeParse({ query: "x" }).success).toBe(false);
    expect(searchStudyNotesInput.safeParse({ query: "bcnf", limit: 99 }).success).toBe(false);
    expect(evaluateAnswerInput.safeParse({ questionId: "q1", answer: "   " }).success).toBe(false);
  });

  it("lists exactly the five planned tools", () => {
    expect(TOOL_NAMES).toHaveLength(5);
  });
});
