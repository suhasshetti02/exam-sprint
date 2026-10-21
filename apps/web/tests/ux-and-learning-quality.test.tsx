// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QuizCard } from "../components/QuizCard";
import { ServerStatus } from "../components/ServerStatus";
import { MasteryPanel } from "../components/MasteryPanel";
import { EvidenceCard } from "../components/EvidenceCard";
import { DBMS_CONCEPT_TEMPLATES } from "../lib/server/document-service";
import type { QuestionData, MasteryConcept, EvidenceData } from "../lib/api-client";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reachable: true,
        protocolVersion: "2025-11-25",
        provider: {
          configured: true,
          model: "gemini-2.5-flash",
          status: "connected",
        },
        serverName: "exam-sprint",
        serverVersion: "0.1.0",
        tools: [{ name: "generate_quiz", description: "", status: "implemented" }],
      }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UX and Learning Quality Regression Suite", () => {
  describe("A. QuizCard Option Labels & Button Layout", () => {
    it("1. Strips duplicate leading letter badges from choices without breaking text or answer selection", () => {
      const onSubmitAnswer = vi.fn();
      const questionWithPrefixedChoices: QuestionData = {
        questionId: "q-normalization-prefix",
        kind: "multiple_choice",
        prompt: "Why is database normalization performed?",
        choices: [
          "A. To eliminate anomalies and unnecessary data redundancy",
          "B. To combine all relations into a single flat file",
          "C) To bypass transactional isolation locks",
          "D: To automatically duplicate all foreign keys across tables",
        ],
        conceptId: "concept-norm",
        evidence: {
          chunkId: "chunk-norm-1",
          quote: "Database normalization organizes tables to reduce data redundancy.",
          status: "verified",
        },
      };

      render(
        <QuizCard
          question={questionWithPrefixedChoices}
          onSubmitAnswer={onSubmitAnswer}
        />,
      );

      // Verify prompt is rendered
      expect(screen.getByText("Why is database normalization performed?")).toBeDefined();

      // The text inside the choice body should NOT repeat "A. " or "C) "
      expect(screen.getByText("To eliminate anomalies and unnecessary data redundancy")).toBeDefined();
      expect(screen.getByText("To combine all relations into a single flat file")).toBeDefined();
      expect(screen.getByText("To bypass transactional isolation locks")).toBeDefined();
      expect(screen.getByText("To automatically duplicate all foreign keys across tables")).toBeDefined();

      // Ensure the badges still show A, B, C, D
      expect(screen.getByText("A")).toBeDefined();
      expect(screen.getByText("B")).toBeDefined();

      // Select option A and submit
      const optionA = screen.getByText("To eliminate anomalies and unnecessary data redundancy");
      fireEvent.click(optionA);

      const submitButton = screen.getByRole("button", { name: /submit answer/i });
      expect(submitButton).toBeDefined();
      // Button must not allow wrapping
      expect(submitButton.className).toContain("whitespace-nowrap");

      fireEvent.click(submitButton);
      expect(onSubmitAnswer).toHaveBeenCalledWith("A");
    });
  });

  describe("B. Truthful Engine & Provider Status Reporting", () => {
    it("2. Accurately reports Last Response Engine as Deterministic Policy when fallback is engaged", async () => {
      render(
        <ServerStatus
          toolTraces={[]}
          lastResponseEngine="deterministic_fallback"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/Active Response Engine:/i)).toBeDefined();
      });
      expect(screen.getByText("Deterministic Policy")).toBeDefined();
    });

    it("3. Accurately reports Last Response Engine as Live AI when LLM generated the turn", async () => {
      render(
        <ServerStatus
          toolTraces={[]}
          lastResponseEngine="llm"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/Active Response Engine:/i)).toBeDefined();
      });
      expect(screen.getByText("Live AI (Agent Loop)")).toBeDefined();
    });
  });

  describe("C. MasteryPanel Clean States & Syllabus Display", () => {
    it("4. Shows syllabus concepts with 0% unassessed state rather than blank empty card when concepts exist", () => {
      const concepts: MasteryConcept[] = [
        {
          conceptId: "normalization",
          mastery: 0,
          attemptsCount: 0,
          openMisconceptions: [],
        },
        {
          conceptId: "acid_properties",
          mastery: 0,
          attemptsCount: 0,
          openMisconceptions: [],
        },
      ];

      render(<MasteryPanel masteryList={concepts} />);

      // Should display concepts with clean human-readable names
      expect(screen.getByText("normalization")).toBeDefined();
      expect(screen.getByText("ACID Properties")).toBeDefined();
      expect(screen.getByText(/Syllabus concepts ready/i)).toBeDefined();
      expect(screen.getAllByText("Not assessed").length).toBe(2);
      expect(screen.getAllByText(/0%/).length).toBeGreaterThanOrEqual(2);
    });

    it("5. Shows empty state only when concept array is truly empty", () => {
      render(<MasteryPanel masteryList={[]} />);
      expect(screen.getByText("No progress recorded")).toBeDefined();
    });
  });

  describe("D. EvidenceCard Divider Formatting & Metadata Provenance", () => {
    it("6. Formats ASCII banners without altering text or losing verified quote highlights", () => {
      const textWithBanner =
        "STUDYFLOW NOTES\n========================================\n1. NORMALIZATION\n========================================\nNormalization organizes relations to reduce data redundancy.";
      const quote = "Normalization organizes relations to reduce data redundancy.";
      const start = textWithBanner.indexOf(quote);
      const end = start + quote.length;

      const evidence: EvidenceData = {
        chunkId: "doc_chunk_1_normalization_section",
        quote,
        status: "verified",
        start,
        end,
        sourceContext: textWithBanner,
      };

      render(
        <EvidenceCard
          evidence={evidence}
          activeDocumentTitle="DBMS Notes"
        />,
      );

      // Verified badge and quote must be intact
      expect(screen.getByText("Verified quote")).toBeDefined();
      const highlightSpan = screen.getByTestId("evidence-highlight-span");
      expect(highlightSpan.textContent).toBe(quote);

      // Provenance details collapsible must contain technical provenance
      expect(screen.getByText(/Technical Provenance/i)).toBeDefined();
    });
  });

  describe("E. Concept Question Distractor Quality", () => {
    it("7. Ensures DBMS_CONCEPT_TEMPLATES have plausible domain misconceptions rather than absurd/unrelated definitions", () => {
      expect(DBMS_CONCEPT_TEMPLATES.length).toBeGreaterThan(0);
      for (const template of DBMS_CONCEPT_TEMPLATES) {
        expect(template.distractors.length).toBeGreaterThanOrEqual(3);
        // Distractors should be relevant to DBMS and not absurd strings
        for (const distractor of template.distractors) {
          expect(distractor.length).toBeGreaterThan(15);
          // Distractor should not contain absurd or placeholder terms
          expect(distractor.toLowerCase()).not.toContain("arbitrary unstructured");
          expect(distractor.toLowerCase()).not.toContain("auxiliary disk data structure");
        }
      }
    });
  });
});
