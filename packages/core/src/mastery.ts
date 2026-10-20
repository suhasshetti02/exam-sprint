/**
 * Deterministic mastery scoring rules and spaced review scheduling.
 *
 * Scoring policy:
 * - Correct answer: +0.25 delta towards mastery (max 1.0).
 * - Partially correct: +0.10 delta towards mastery (max 1.0).
 * - Incorrect answer: -0.20 delta (min 0.0).
 *
 * Spaced review policy:
 * - High mastery (>= 0.8): review scheduled in 3 days.
 * - Moderate mastery (>= 0.5): review scheduled in 1 day.
 * - Low mastery (< 0.5): review scheduled in 4 hours.
 *
 * This module is pure business logic, free of server-only and framework dependencies.
 */

import type { Verdict } from "./domain";

export const MASTERY_DELTAS: Record<Verdict, number> = {
  correct: 0.25,
  partially_correct: 0.1,
  incorrect: -0.2,
};

/**
 * Calculates updated concept mastery after a graded attempt.
 * Result is clamped to [0.0, 1.0] and rounded to two decimal places.
 */
export function calculateMastery(currentMastery: number, verdict: Verdict): number {
  const delta = MASTERY_DELTAS[verdict] ?? 0;
  const raw = currentMastery + delta;
  const clamped = Math.max(0, Math.min(1, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * Computes an ISO-8601 UTC timestamp for when a concept should next be reviewed,
 * based on the learner's current mastery level.
 */
export function calculateNextReview(mastery: number, baseDate: Date = new Date()): string {
  const next = new Date(baseDate.getTime());
  if (mastery >= 0.8) {
    next.setDate(next.getDate() + 3);
  } else if (mastery >= 0.5) {
    next.setDate(next.getDate() + 1);
  } else {
    next.setHours(next.getHours() + 4);
  }
  return next.toISOString();
}
