/**
 * DBMS question bank types and helpers.
 * Shared between core, server, and tests.
 */

import type { QuestionRecord } from "./domain";

export type QuestionBank = QuestionRecord[];

/**
 * Filter questions for a given concept and focus mode.
 * - 'new': prioritize questions without attempts
 * - 'weak': prioritize questions linked to open misconceptions
 * - 'review': prioritize questions due for review
 */
export function filterQuestions(
  questions: QuestionRecord[],
  conceptId: string,
  options?: {
    attemptedQuestionIds?: Set<string>;
    openMisconceptionLabels?: Set<string>;
    targetedMisconceptionLabel?: string;
    excludeQuestionId?: string;
    focus?: "new" | "weak" | "review";
    count?: number;
  },
): QuestionRecord[] {
  let matching = questions.filter((q) => q.conceptId === conceptId);
  if (matching.length === 0) return [];

  // Exclude current question if requested and other questions for this concept exist
  if (options?.excludeQuestionId && matching.length > 1) {
    const withoutExcluded = matching.filter((q) => q.id !== options.excludeQuestionId);
    if (withoutExcluded.length > 0) {
      matching = withoutExcluded;
    }
  }

  const focus = options?.focus ?? "new";
  const attempted = options?.attemptedQuestionIds ?? new Set<string>();
  const openMisc = options?.openMisconceptionLabels ?? new Set<string>();
  const targetedMisc = options?.targetedMisconceptionLabel;

  const sorted = [...matching].sort((a, b) => {
    // 1. If a specific misconception is targeted for recovery, strictly prioritize questions testing it
    if (targetedMisc) {
      const aMatchesTarget = a.expected.misconceptions?.some((m) => m.label === targetedMisc) ? 1 : 0;
      const bMatchesTarget = b.expected.misconceptions?.some((m) => m.label === targetedMisc) ? 1 : 0;
      if (aMatchesTarget !== bMatchesTarget) return bMatchesTarget - aMatchesTarget;

      // Between questions matching the target misconception, prioritize an unattempted question
      const aAttempted = attempted.has(a.id) ? 1 : 0;
      const bAttempted = attempted.has(b.id) ? 1 : 0;
      if (aAttempted !== bAttempted) return aAttempted - bAttempted;
    }

    if (focus === "weak") {
      // Prioritize questions addressing open misconceptions
      const aHasMisc = a.expected.misconceptions?.some((m) => openMisc.has(m.label)) ? 1 : 0;
      const bHasMisc = b.expected.misconceptions?.some((m) => openMisc.has(m.label)) ? 1 : 0;
      if (aHasMisc !== bHasMisc) return bHasMisc - aHasMisc;
    } else if (focus === "new") {
      // Prioritize unattempted questions
      const aAttempted = attempted.has(a.id) ? 1 : 0;
      const bAttempted = attempted.has(b.id) ? 1 : 0;
      if (aAttempted !== bAttempted) return aAttempted - bAttempted;
    }
    return a.id.localeCompare(b.id);
  });

  const count = options?.count ?? 1;
  return sorted.slice(0, count);
}
