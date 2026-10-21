/**
 * Domain types shared by the web app and the MCP server.
 * This module must stay free of React, Next.js, Node-only and MCP SDK imports.
 */

/** A study document supplied by the student (or bundled sample notes). */
export interface SourceDocument {
  id: string;
  title: string;
  /** Provenance label, e.g. "sample" or "student-upload". */
  origin: string;
}

/** A retrievable passage. `id` is stable: `<documentId>#<section-slug>`. */
export interface SourceChunk {
  id: string;
  documentId: string;
  heading: string;
  ordinal: number;
  text: string;
}

/**
 * A claim that a quotation appears in a specific chunk.
 * A reference is only trustworthy after an EvidenceVerifier has accepted it.
 */
export interface EvidenceReference {
  chunkId: string;
  quote: string;
  /** Character offsets of the quote inside the chunk text, set by the verifier. */
  start?: number;
  end?: number;
  /** Full text of the cited source chunk to provide surrounding context. */
  sourceContext?: string;
}

export type VerificationStatus = "verified" | "unverified" | "rejected";

export interface VerifiedEvidence extends EvidenceReference {
  status: VerificationStatus;
}

export interface Concept {
  id: string;
  title: string;
  documentId: string;
}

export interface ConceptMastery {
  studentId: string;
  conceptId: string;
  /** 0 (no demonstrated mastery) to 1 (consistently correct). */
  mastery: number;
  attemptsCount: number;
  lastAttemptAt?: string;
  nextReviewAt?: string;
}

export type MisconceptionStatus = "open" | "in_recovery" | "resolved";

export interface Misconception {
  id: string;
  studentId: string;
  conceptId: string;
  /** Short machine-friendly label, e.g. "confuses-3nf-with-bcnf". */
  label: string;
  description: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  status?: MisconceptionStatus;
}

export type QuestionKind = "multiple_choice" | "short_answer";
export type Verdict = "correct" | "partially_correct" | "incorrect";

export interface QuestionMisconceptionRule {
  /** Choice letter (e.g. 'B') for MCQs or trigger keywords/phrases for short answer. */
  pattern?: string[];
  choiceLetter?: string;
  label: string;
  explanation: string;
}

export interface QuestionRubric {
  kind: QuestionKind;
  correctAnswer: string;
  acceptableVariants?: string[];
  partialVariants?: string[];
  misconceptions?: QuestionMisconceptionRule[];
  explanation: string;
}

export interface QuestionRecord {
  id: string;
  conceptId: string;
  kind: QuestionKind;
  prompt: string;
  choices?: string[];
  expected: QuestionRubric;
  evidenceChunkId: string;
  evidenceQuote: string;
  evidenceStart?: number;
  evidenceEnd?: number;
  verifiedAt?: string;
}

export interface RetestItem {
  id: string;
  studentId: string;
  misconceptionId: string;
  dueAt: string;
  status: "pending" | "completed" | "skipped";
  completedAttemptId?: string;
}
