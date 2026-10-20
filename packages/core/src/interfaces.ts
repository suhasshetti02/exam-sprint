import type {
  ConceptMastery,
  EvidenceReference,
  Misconception,
  SourceChunk,
  Verdict,
  VerificationStatus,
  VerifiedEvidence,
} from "./domain";

/** Deterministic keyword/BM25-style retrieval over stored chunks. */
export interface Retriever {
  search(query: string, limit: number, documentId?: string): Promise<Array<{ chunk: SourceChunk; score: number }>>;
}

/**
 * Checks that a claimed quotation really occurs in the cited chunk
 * (after whitespace/case normalisation). Never trusts model output.
 */
export interface EvidenceVerifier {
  verify(
    reference: EvidenceReference,
    chunk: SourceChunk | undefined,
  ): { status: VerificationStatus; reference: EvidenceReference };
}

export interface EvaluationResult {
  verdict: Verdict;
  explanation: string;
  evidence: VerifiedEvidence;
  misconceptionLabel?: string;
  conceptId?: string;
}

export interface AnswerEvaluator {
  evaluate(input: { questionId: string; answer: string }): Promise<EvaluationResult>;
}

export interface ProgressUpdate {
  attemptId: string;
  mastery: ConceptMastery;
  misconception?: Misconception;
  retestScheduled: boolean;
  misconceptionResolved?: boolean;
  resolvedMisconceptionLabel?: string;
  recoveryStatus?: "open" | "in_recovery" | "resolved";
}

export interface ProgressStore {
  getMastery(studentId: string, conceptIds?: string[]): Promise<ConceptMastery[]>;
  recordAttempt(input: {
    studentId: string;
    questionId: string;
    answer: string;
    verdict: Verdict;
    misconceptionLabel?: string;
    recoveryForMisconceptionLabel?: string;
  }): Promise<ProgressUpdate>;
}
