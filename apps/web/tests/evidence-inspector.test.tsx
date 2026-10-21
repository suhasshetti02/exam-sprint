// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EvidenceCard, renderHighlightedEvidence } from "../components/EvidenceCard";
import type { EvidenceData } from "../lib/api-client";

afterEach(() => {
  cleanup();
});

describe("Interactive Source-Evidence Inspector & Offset Verification", () => {
  describe("renderHighlightedEvidence pure helper", () => {
    const fullText = "A relation is in First Normal Form (1NF) if all attributes contain atomic values. Every column must be single-valued.";
    const targetQuote = "all attributes contain atomic values";
    const startOffset = fullText.indexOf(targetQuote);
    const endOffset = startOffset + targetQuote.length;

    it("1. Correctly slices exact valid offsets", () => {
      const res = renderHighlightedEvidence(fullText, targetQuote, startOffset, endOffset);
      expect(res.offsetStatus).toBe("exact");
      expect(res.highlighted).toBe(targetQuote);
      expect(res.before).toBe(fullText.slice(0, startOffset));
      expect(res.after).toBe(fullText.slice(endOffset));
    });

    it("2. Recovers substring match when offsets are missing or undefined", () => {
      const res = renderHighlightedEvidence(fullText, targetQuote, undefined, undefined);
      expect(res.offsetStatus).toBe("recovered");
      expect(res.highlighted).toBe(targetQuote);
      expect(res.before).toBe(fullText.slice(0, startOffset));
      expect(res.after).toBe(fullText.slice(endOffset));
    });

    it("3. Recovers substring match when offsets are shifted or inaccurate", () => {
      const res = renderHighlightedEvidence(fullText, targetQuote, 5, 20);
      expect(res.offsetStatus).toBe("recovered");
      expect(res.highlighted).toBe(targetQuote);
      expect(res.before).toBe(fullText.slice(0, startOffset));
      expect(res.after).toBe(fullText.slice(endOffset));
    });

    it("4. Safely handles out-of-range offsets (negative, end < start, or beyond length)", () => {
      const resNegative = renderHighlightedEvidence(fullText, targetQuote, -10, 15);
      expect(resNegative.highlighted).toBe(targetQuote);
      expect(resNegative.offsetStatus).toBe("recovered");

      const resInverted = renderHighlightedEvidence(fullText, targetQuote, 50, 20);
      expect(resInverted.highlighted).toBe(targetQuote);
      expect(resInverted.offsetStatus).toBe("recovered");

      const resOutOfBounds = renderHighlightedEvidence(fullText, targetQuote, 9999, 10050);
      expect(resOutOfBounds.highlighted).toBe(targetQuote);
      expect(resOutOfBounds.offsetStatus).toBe("recovered");
    });

    it("5. Safely handles missing sourceContext or missing quote without throwing", () => {
      const resNoContext = renderHighlightedEvidence(undefined, targetQuote, startOffset, endOffset);
      expect(resNoContext.offsetStatus).toBe("fallback");
      expect(resNoContext.highlighted).toBe(targetQuote);
      expect(resNoContext.before).toBe("");
      expect(resNoContext.after).toBe("");

      const resNoQuote = renderHighlightedEvidence(fullText, "", 0, 0);
      expect(resNoQuote.offsetStatus).toBe("fallback");
      expect(resNoQuote.highlighted).toBe("");
    });

    it("6. Correctly handles special characters, HTML tokens, ampersands, and unicode math symbols", () => {
      const specialText = "Notes on Relations: R(A, B) → C & D satisfies 2NF if ∀ non-prime attribute α ∉ candidate_key <whole>.";
      const specialQuote = "R(A, B) → C & D satisfies 2NF";
      const s = specialText.indexOf(specialQuote);
      const e = s + specialQuote.length;

      const res = renderHighlightedEvidence(specialText, specialQuote, s, e);
      expect(res.offsetStatus).toBe("exact");
      expect(res.highlighted).toBe(specialQuote);
      expect(res.before).toBe("Notes on Relations: ");
      expect(res.after).toBe(" if ∀ non-prime attribute α ∉ candidate_key <whole>.");
    });
  });

  describe("EvidenceCard Component Visual & Interactive Behavior", () => {
    it("7. Displays surrounding passage and marks the highlighted evidence span for verified notes", () => {
      const fullText = "Introduction to Database Systems. A relation is in Second Normal Form (2NF) when all partial functional dependencies are eliminated. Third Normal Form further eliminates transitive dependencies.";
      const quote = "all partial functional dependencies are eliminated";
      const start = fullText.indexOf(quote);
      const end = start + quote.length;

      const evidence: EvidenceData = {
        chunkId: "chunk-dbms-2nf",
        quote,
        status: "verified",
        start,
        end,
        sourceContext: fullText,
      };

      render(
        <EvidenceCard
          evidence={evidence}
          activeDocumentTitle="DBMS Study Guide"
        />,
      );

      // Verified badge must be present
      expect(screen.getByText("Verified quote")).toBeDefined();
      expect(screen.getByText("Why is this answer correct?")).toBeDefined();
      expect(screen.getByText("DBMS Study Guide")).toBeDefined();
      expect(screen.getByText("Supporting passage verified against the document")).toBeDefined();

      // Highlighted span check
      const highlightSpan = screen.getByTestId("evidence-highlight-span");
      expect(highlightSpan.textContent).toBe(quote);

      // Surrounding context must be rendered
      expect(screen.getByText(/Introduction to Database Systems/)).toBeDefined();
      expect(screen.getByText(/Third Normal Form further eliminates/)).toBeDefined();
    });

    it("8. Never displays a verified badge or success styling for unverified or rejected evidence", () => {
      const rejectedEvidence: EvidenceData = {
        chunkId: "chunk-unverified",
        quote: "Unverified claim that does not appear in study notes",
        status: "rejected",
      };

      const { container } = render(
        <EvidenceCard evidence={rejectedEvidence} />,
      );

      // Verified badge must NEVER be displayed
      expect(screen.queryByText("Verified quote")).toBeNull();
      expect(screen.getByText("Quotation Rejected")).toBeDefined();
      expect(container.querySelector('[data-testid="evidence-highlight-span"]')).toBeNull();
    });

    it("9. Displays empty state when no evidence is loaded", () => {
      render(<EvidenceCard evidence={undefined} />);
      expect(screen.getByText("No evidence quotation yet")).toBeDefined();
      expect(screen.queryByText("Verified quote")).toBeNull();
    });

    it("10. Fires interactive action callbacks (Explain simply, Give an example, Quiz me)", () => {
      const onExplainSimply = vi.fn();
      const onGiveExample = vi.fn();
      const onQuizMe = vi.fn();

      const evidence: EvidenceData = {
        chunkId: "chunk-test",
        quote: "Atomicity ensures all-or-nothing execution.",
        status: "verified",
        sourceContext: "ACID properties: Atomicity ensures all-or-nothing execution. Consistency preserves invariants.",
      };

      render(
        <EvidenceCard
          evidence={evidence}
          onExplainSimply={onExplainSimply}
          onGiveExample={onGiveExample}
          onQuizMe={onQuizMe}
        />,
      );

      const explainBtn = screen.getByRole("button", { name: /explain simply/i });
      const exampleBtn = screen.getByRole("button", { name: /give an example/i });
      const quizBtn = screen.getByRole("button", { name: /quiz me/i });

      fireEvent.click(explainBtn);
      expect(onExplainSimply).toHaveBeenCalledTimes(1);

      fireEvent.click(exampleBtn);
      expect(onGiveExample).toHaveBeenCalledTimes(1);

      fireEvent.click(quizBtn);
      expect(onQuizMe).toHaveBeenCalledTimes(1);
    });
  });
});
