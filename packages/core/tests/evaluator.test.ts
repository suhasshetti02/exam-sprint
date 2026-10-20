import { describe, expect, it } from "vitest";
import {
  cleanText,
  DeterministicAnswerEvaluator,
  extractChoiceLetter,
  isDontKnow,
} from "../src/evaluator";
import { DefaultEvidenceVerifier } from "../src/evidence-verifier";
import type { QuestionRecord, SourceChunk } from "../src/domain";

const verifier = new DefaultEvidenceVerifier();
const evaluator = new DeterministicAnswerEvaluator(verifier);

const sampleChunk: SourceChunk = {
  id: "dbms-normalization#second-normal-form",
  documentId: "dbms-normalization",
  heading: "Second normal form",
  ordinal: 3,
  text: "A table is in second normal form when it is in first normal form and no non-key attribute depends on only part of a composite candidate key. Partial dependencies are the problem this form removes.",
};

const mcqQuestion: QuestionRecord = {
  id: "q-2nf-mcq",
  conceptId: "2nf",
  kind: "multiple_choice",
  prompt: "When is a table in second normal form?",
  choices: [
    "A. When no non-key attribute depends on part of a composite candidate key",
    "B. When every determinant is a superkey",
    "C. When all transitive dependencies are removed",
  ],
  expected: {
    kind: "multiple_choice",
    correctAnswer: "A",
    misconceptions: [
      {
        choiceLetter: "B",
        label: "confuses-2nf-with-bcnf",
        explanation: "Determinants being superkeys defines BCNF.",
      },
      {
        choiceLetter: "C",
        label: "confuses-2nf-with-3nf",
        explanation: "Transitive dependencies are removed by 3NF.",
      },
    ],
    explanation: "2NF requires removing partial dependencies on composite keys.",
  },
  evidenceChunkId: "dbms-normalization#second-normal-form",
  evidenceQuote: "Partial dependencies are the problem this form removes.",
};

const shortAnswerQuestion: QuestionRecord = {
  id: "q-2nf-sa",
  conceptId: "2nf",
  kind: "short_answer",
  prompt: "What type of dependency is removed by 2NF?",
  expected: {
    kind: "short_answer",
    correctAnswer: "Partial dependencies",
    acceptableVariants: ["partial dependencies", "partial dependency"],
    partialVariants: ["dependencies on composite key"],
    misconceptions: [
      {
        pattern: ["transitive"],
        label: "confuses-2nf-with-3nf",
        explanation: "Transitive dependencies are removed in 3NF.",
      },
    ],
    explanation: "2NF removes partial dependencies.",
  },
  evidenceChunkId: "dbms-normalization#second-normal-form",
  evidenceQuote: "Partial dependencies are the problem this form removes.",
};

describe("DeterministicAnswerEvaluator", () => {
  describe("multiple choice evaluation", () => {
    it("evaluates a correct choice correctly and includes verified evidence", () => {
      const res = evaluator.evaluate(mcqQuestion, "A", sampleChunk);
      expect(res.verdict).toBe("correct");
      expect(res.evidence.status).toBe("verified");
      expect(typeof res.evidence.start).toBe("number");
      expect(typeof res.evidence.end).toBe("number");
      expect(res.misconceptionLabel).toBeUndefined();
    });

    it("accepts variant formats like 'Choice A' or 'Option A.'", () => {
      expect(evaluator.evaluate(mcqQuestion, "Choice A", sampleChunk).verdict).toBe("correct");
      expect(evaluator.evaluate(mcqQuestion, "option a.", sampleChunk).verdict).toBe("correct");
    });

    it("identifies a known misconception for choice B", () => {
      const res = evaluator.evaluate(mcqQuestion, "B", sampleChunk);
      expect(res.verdict).toBe("incorrect");
      expect(res.misconceptionLabel).toBe("confuses-2nf-with-bcnf");
      expect(res.explanation).toContain("BCNF");
      expect(res.evidence.status).toBe("verified");
    });

    it("marks unexpected choices as incorrect without misconception label", () => {
      const res = evaluator.evaluate(mcqQuestion, "D", sampleChunk);
      expect(res.verdict).toBe("incorrect");
      expect(res.misconceptionLabel).toBeUndefined();
    });
  });

  describe("short answer evaluation", () => {
    it("marks exact and acceptable variant answers as correct", () => {
      const res1 = evaluator.evaluate(shortAnswerQuestion, "Partial dependencies", sampleChunk);
      expect(res1.verdict).toBe("correct");
      expect(res1.evidence.status).toBe("verified");

      const res2 = evaluator.evaluate(shortAnswerQuestion, "partial dependency", sampleChunk);
      expect(res2.verdict).toBe("correct");
    });

    it("awards partial credit for partial variants", () => {
      const res = evaluator.evaluate(
        shortAnswerQuestion,
        "it removes dependencies on composite key",
        sampleChunk,
      );
      expect(res.verdict).toBe("partially_correct");
      expect(res.explanation).toContain("Partially correct");
      expect(res.evidence.status).toBe("verified");
    });

    it("identifies a known misconception from trigger keywords", () => {
      const res = evaluator.evaluate(
        shortAnswerQuestion,
        "it removes transitive dependencies",
        sampleChunk,
      );
      expect(res.verdict).toBe("incorrect");
      expect(res.misconceptionLabel).toBe("confuses-2nf-with-3nf");
      expect(res.explanation).toContain("Transitive dependencies are removed in 3NF");
    });

    it("marks unknown answers as incorrect without misconception", () => {
      const res = evaluator.evaluate(shortAnswerQuestion, "it eliminates null values", sampleChunk);
      expect(res.verdict).toBe("incorrect");
      expect(res.misconceptionLabel).toBeUndefined();
    });

    it("evaluates 'don't know' supportively without awarding mastery or false misconceptions", () => {
      const dontKnowVariants = ["I don't know", "idk", "not sure", "no idea", "pass"];
      for (const variant of dontKnowVariants) {
        const res = evaluator.evaluate(shortAnswerQuestion, variant, sampleChunk);
        expect(res.verdict).toBe("incorrect");
        expect(res.misconceptionLabel).toBeUndefined();
        expect(res.conceptId).toBe("2nf");
        expect(res.explanation).toContain("No worries at all! Here is the key distinction from your study notes:");
        expect(res.explanation).toContain(shortAnswerQuestion.expected.explanation);
        expect(res.evidence.status).toBe("verified");
      }
    });

    it("evaluates 'don't know' on multiple choice questions supportively as incorrect", () => {
      const res = evaluator.evaluate(mcqQuestion, "don't know", sampleChunk);
      expect(res.verdict).toBe("incorrect");
      expect(res.misconceptionLabel).toBeUndefined();
      expect(res.conceptId).toBe("2nf");
      expect(res.explanation).toContain("No worries at all!");
    });

    it("rejects evidence when chunk is missing", () => {
      const res = evaluator.evaluate(shortAnswerQuestion, "Partial dependencies", undefined);
      expect(res.verdict).toBe("correct");
      expect(res.evidence.status).toBe("rejected");
    });
  });

  describe("text extraction utilities", () => {
    it("extracts letter from various choice formats", () => {
      expect(extractChoiceLetter("A")).toBe("A");
      expect(extractChoiceLetter("b")).toBe("B");
      expect(extractChoiceLetter("Choice C")).toBe("C");
      expect(extractChoiceLetter("Option D:")).toBe("D");
    });

    it("cleans text reliably", () => {
      expect(cleanText("  Hello, World! -- 123? ")).toBe("hello world 123");
    });

    it("identifies diverse 'don't know' variants via isDontKnow", () => {
      expect(isDontKnow("don't know")).toBe(true);
      expect(isDontKnow("dont know")).toBe(true);
      expect(isDontKnow("idk")).toBe(true);
      expect(isDontKnow("i don't know the answer")).toBe(true);
      expect(isDontKnow("not sure")).toBe(true);
      expect(isDontKnow("no idea")).toBe(true);
      expect(isDontKnow("help")).toBe(true);
      expect(isDontKnow("skip")).toBe(true);
      expect(isDontKnow("pass")).toBe(true);
      expect(isDontKnow("explain")).toBe(true);
      expect(isDontKnow("partial dependencies")).toBe(false);
      expect(isDontKnow("superkey")).toBe(false);

      // Verifies ordinary substantive technical responses are NOT swallowed
      expect(isDontKnow("Pass by value makes a copy of the argument")).toBe(false);
      expect(isDontKnow("pass the key parameter to the index function")).toBe(false);
      expect(isDontKnow("Explain plan in SQL shows query execution steps")).toBe(false);
      expect(isDontKnow("unsure, but I think it is partial dependencies")).toBe(false);
    });

    it("does not mistake natural language sentences starting with 'A' or 'B' as MCQ choices", () => {
      expect(extractChoiceLetter("A table in first normal form has atomic attributes")).toBeNull();
      expect(extractChoiceLetter("B-tree indexes provide logarithmic search complexity")).toBeNull();
      expect(extractChoiceLetter("A relation cannot have duplicate rows")).toBeNull();

      // Explicit selections must still match
      expect(extractChoiceLetter("A")).toBe("A");
      expect(extractChoiceLetter("Option A")).toBe("A");
      expect(extractChoiceLetter("Choice B.")).toBe("B");
      expect(extractChoiceLetter("d)")).toBe("D");
    });
  });

  describe("evaluator robustness and negation handling", () => {
    it("rejects contradictory answers containing negated acceptable keywords", () => {
      const res = evaluator.evaluate(
        shortAnswerQuestion,
        "it does not remove partial dependencies",
        sampleChunk,
      );
      expect(res.verdict).toBe("incorrect");
      expect(res.explanation).toContain("Contradictory negation");
    });

    it("evaluates known misconception before granting variant credit", () => {
      // Conflicting statement mentioning transitive (misconception) alongside partial (accepted)
      const res = evaluator.evaluate(
        shortAnswerQuestion,
        "it removes transitive dependencies instead of partial dependencies",
        sampleChunk,
      );
      expect(res.verdict).toBe("incorrect");
      expect(res.misconceptionLabel).toBe("confuses-2nf-with-3nf");
    });

    it("evaluates document-generated questions with canonical QuestionRubric schema", () => {
      const docQuestion: QuestionRecord = {
        id: "q_up_doc1_sec1",
        conceptId: "doc1__section-1",
        kind: "multiple_choice",
        prompt: "Based on the section, which statement is supported?",
        choices: [
          "Partial dependencies are the problem this form removes.",
          "The opposite statement",
          "Obsolete in the text",
          "None of the above",
        ],
        expected: {
          kind: "multiple_choice",
          correctAnswer: "A",
          acceptableVariants: ["Partial dependencies are the problem this form removes."],
          explanation: "Verified quote directly from your notes",
        },
        evidenceChunkId: "dbms-normalization#second-normal-form",
        evidenceQuote: "Partial dependencies are the problem this form removes.",
        evidenceStart: 125,
        evidenceEnd: 181,
      };

      // Correct choice
      const correctRes = evaluator.evaluate(docQuestion, "A", sampleChunk);
      expect(correctRes.verdict).toBe("correct");
      expect(correctRes.evidence.status).toBe("verified");
      expect(correctRes.evidence.start).toBe(141);

      // Incorrect choice
      const incorrectRes = evaluator.evaluate(docQuestion, "B", sampleChunk);
      expect(incorrectRes.verdict).toBe("incorrect");
      expect(incorrectRes.evidence.status).toBe("verified");
    });
  });
});

