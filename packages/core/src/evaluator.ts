/**
 * Deterministic rubric-based answer evaluation.
 * Evaluates student answers against question rubrics without LLM calls.
 * Never writes to database or updates mastery as a side effect.
 */

import type {
  EvaluationResult,
  EvidenceVerifier,
} from "./interfaces";
import type {
  QuestionRecord,
  SourceChunk,
  Verdict,
} from "./domain";
import { normalise } from "./evidence-verifier";

/** Strips basic punctuation and collapses whitespace. */
export function cleanText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects if a student answer contains negation terms (not, no, never, without, fails, etc.)
 */
export function hasNegation(text: string): boolean {
  const norm = cleanText(text);
  const words = norm.split(/\s+/);
  const negationWords = new Set([
    "not",
    "no",
    "never",
    "neither",
    "nor",
    "cannot",
    "cant",
    "without",
    "fails",
    "failed",
    "doesnt",
    "isnt",
    "arent",
    "wont",
    "incorrect",
    "opposite",
  ]);

  return words.some((w) => negationWords.has(w));
}

/**
 * Parses multiple-choice answers, extracting choice letters (A, B, C, D)
 * from explicit selections like "B", "b", "Option B", "Choice B.", or matching full choice text.
 * Never misidentifies natural language sentences starting with "A" or "B" as choice selections.
 */
export function extractChoiceLetter(
  answer: string,
  choices?: string[],
): string | null {
  const trimmed = answer.trim();
  if (!trimmed) return null;

  // 1. Standalone single letter: "A", "a", "A.", "A:", "A)", "(A)", "[A]"
  const standaloneMatch = /^(?:\(?\[?([a-dA-D])\)?\]?[.:)]?)$/.exec(trimmed);
  if (standaloneMatch && standaloneMatch[1]) {
    return standaloneMatch[1].toUpperCase();
  }

  // 2. Explicit "Option/Choice X", e.g. "Option A", "Choice B.", "choice (c)"
  const explicitChoiceMatch = /^(?:option|choice)\s+([a-dA-D])(?:\.|[:)\s]|$)/i.exec(trimmed);
  if (explicitChoiceMatch && explicitChoiceMatch[1]) {
    return explicitChoiceMatch[1].toUpperCase();
  }

  // 3. Choice letter with label prefix followed by text matching that choice, e.g. "A. When no non-key attribute..."
  const prefixMatch = /^([a-dA-D])[.:)]\s+(.*)$/i.exec(trimmed);
  if (prefixMatch && prefixMatch[1]) {
    const letter = prefixMatch[1].toUpperCase();
    const restText = prefixMatch[2]?.trim() || "";
    if (choices && choices.length > 0) {
      const idx = letter.charCodeAt(0) - 65;
      if (idx >= 0 && idx < choices.length) {
        const choice = choices[idx];
        if (choice) {
          const normRest = cleanText(restText);
          const normChoice = cleanText(choice).replace(/^[a-d]\s+/, "");
          if (normRest === normChoice || normChoice.includes(normRest) || normRest.includes(normChoice)) {
            return letter;
          }
        }
      }
    } else {
      return letter;
    }
  }

  // 4. Full text match against one of the choices
  if (choices && choices.length > 0) {
    const normAnswer = cleanText(answer);
    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      if (!choice) continue;
      const letter = String.fromCharCode(65 + i); // 0 -> A, 1 -> B, etc.
      const normChoice = cleanText(choice);
      const strippedChoice = normChoice.replace(/^[a-d]\s+/, "");
      if (normAnswer === normChoice || normAnswer === strippedChoice) {
        return letter;
      }
    }
  }

  return null;
}

/**
 * Checks whether an answer is an intentional admission of not knowing (e.g. "don't know", "idk").
 * Never misclassifies technical explanations starting with words like "pass", "explain", or "unsure".
 */
export function isDontKnow(input: string): boolean {
  const norm = cleanText(input);
  if (!norm) return false;

  // Exact standalone keywords indicating giving up
  const standaloneGivingUp = new Set([
    "dont know",
    "don t know",
    "do not know",
    "idk",
    "no idea",
    "not sure",
    "unsure",
    "help",
    "skip",
    "pass",
    "explain",
  ]);

  if (standaloneGivingUp.has(norm)) {
    return true;
  }

  // Multi-word phrases that clearly express giving up or not knowing
  const explicitPhrases = [
    "i dont know",
    "i don t know",
    "i do not know",
    "i have no idea",
    "i am not sure",
    "im not sure",
    "dont understand",
    "i dont understand",
    "do not understand",
    "can you explain",
    "please explain",
    "skip this",
    "pass on this",
    "no clue",
    "i have no clue",
  ];

  for (const phrase of explicitPhrases) {
    if (norm === phrase) return true;
    if (norm.startsWith(phrase + " ")) {
      const rest = norm.slice(phrase.length).trim();
      const nonSubstantive = [
        "the answer",
        "this",
        "this one",
        "what this is",
        "at all",
        "answer",
        "it",
        "sorry",
      ];
      if (rest.length === 0 || nonSubstantive.some((ns) => rest === ns || rest.startsWith(ns))) {
        return true;
      }
    }
  }

  return false;
}

export class DeterministicAnswerEvaluator {
  constructor(private verifier: EvidenceVerifier) {}

  public evaluate(
    question: QuestionRecord,
    answer: string,
    chunk?: SourceChunk,
  ): EvaluationResult {
    let verdict: Verdict = "incorrect";
    let explanation = question.expected.explanation;
    let misconceptionLabel: string | undefined;

    const trimmedAnswer = answer.trim();

    if (isDontKnow(trimmedAnswer)) {
      verdict = "incorrect";
      explanation = `No worries at all! Here is the key distinction from your study notes: ${question.expected.explanation}`;
      misconceptionLabel = undefined;
    } else if (question.kind === "multiple_choice") {
      const chosenLetter = extractChoiceLetter(trimmedAnswer, question.choices);
      const rawCorrect = question.expected.correctAnswer || "A";
      const correctLetter = rawCorrect.trim().toUpperCase();

      if (chosenLetter && chosenLetter === correctLetter) {
        verdict = "correct";
        explanation = question.expected.explanation;
      } else {
        verdict = "incorrect";
        // Check for mapped misconception for the chosen letter
        if (chosenLetter && question.expected.misconceptions) {
          const matchedMisc = question.expected.misconceptions.find(
            (m) => m.choiceLetter?.toUpperCase() === chosenLetter,
          );
          if (matchedMisc) {
            misconceptionLabel = matchedMisc.label;
            explanation = matchedMisc.explanation;
          } else {
            explanation = `Incorrect. The correct answer is ${correctLetter}. ${question.expected.explanation}`;
          }
        } else {
          explanation = `Incorrect. The correct answer is ${correctLetter}. ${question.expected.explanation}`;
        }
      }
    } else {
      // Short answer evaluation
      const normStudent = cleanText(trimmedAnswer);
      const normExpected = cleanText(question.expected.correctAnswer || "");

      // 1. Check for specific misconceptions FIRST to protect diagnostic accuracy
      let matchedMisconception:
        | (typeof question.expected.misconceptions extends (infer T)[] | undefined ? T : never)
        | undefined;

      if (question.expected.misconceptions) {
        for (const misc of question.expected.misconceptions) {
          if (misc.pattern && misc.pattern.length > 0) {
            const matches = misc.pattern.some((pat) => {
              const normPat = cleanText(pat);
              return normStudent.includes(normPat);
            });
            if (matches) {
              matchedMisconception = misc;
              break;
            }
          }
        }
      }

      if (matchedMisconception) {
        verdict = "incorrect";
        misconceptionLabel = matchedMisconception.label;
        explanation = matchedMisconception.explanation;
      } else {
        // 2. Check for exact or acceptable match with negation guard
        const studentHasNegation = hasNegation(normStudent);
        const expectedHasNegation = hasNegation(normExpected);
        const acceptable = (question.expected.acceptableVariants ?? []).map(cleanText);

        const isExactMatch =
          normStudent === normExpected || acceptable.some((v) => normStudent === v);

        // Substring match is only valid if student is not asserting a contradictory negation
        const isSubstringAccepted =
          !studentHasNegation &&
          acceptable.some((v) => !hasNegation(v) && v.length >= 6 && normStudent.includes(v));

        if (isExactMatch || isSubstringAccepted) {
          verdict = "correct";
          explanation = question.expected.explanation;
        } else if (studentHasNegation && !expectedHasNegation) {
          // Contradictory negation of expected positive concept
          verdict = "incorrect";
          explanation = `Incorrect. Contradictory negation detected. ${question.expected.explanation}`;
        } else {
          // 3. Check for partial credit
          const partial = (question.expected.partialVariants ?? []).map(cleanText);
          const isPartial =
            !studentHasNegation &&
            partial.some((p) => normStudent === p || (p.length >= 6 && normStudent.includes(p)));

          if (isPartial) {
            verdict = "partially_correct";
            explanation = `Partially correct. ${question.expected.explanation}`;
          } else {
            verdict = "incorrect";
            explanation = `Incorrect. ${question.expected.explanation}`;
          }
        }
      }
    }

    // Verify source evidence using the real evidence verifier
    const verification = this.verifier.verify(
      {
        chunkId: question.evidenceChunkId,
        quote: question.evidenceQuote,
      },
      chunk,
    );

    return {
      verdict,
      explanation,
      evidence: {
        chunkId: question.evidenceChunkId,
        quote: normalise(question.evidenceQuote),
        status: verification.status,
        start: verification.reference.start,
        end: verification.reference.end,
      },
      misconceptionLabel,
      conceptId: question.conceptId,
    };
  }
}
