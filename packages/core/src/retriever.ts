/**
 * In-memory BM25 retriever over a fixed set of SourceChunk objects.
 *
 * Algorithm: Okapi BM25 with k1 = 1.5, b = 0.75.
 * Tokenisation: lowercase, split on non-alphanumeric, discard empty tokens and
 * single-character tokens (reduces noise from punctuation artefacts).
 *
 * Limitations (documented):
 *   - No stemming or stop-word removal.  "normalize" and "normalization" are
 *     different tokens; queries should use the same form as the notes.
 *   - The index is built eagerly at construction time.  It is not persistent.
 *   - Score 0 means no query term appears in the chunk.
 *   - Suitable for a few dozen chunks; does not scale to millions.
 *
 * This module must stay free of FS, Node-only, and framework imports.
 */

import type { SourceChunk } from "./domain";
import type { Retriever } from "./interfaces";

const K1 = 1.5;
const B = 0.75;

/** Tokenise text into lowercase non-trivial words. */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

interface IndexEntry {
  chunk: SourceChunk;
  /** term → within-doc frequency */
  tf: Map<string, number>;
  length: number; // total token count
}

/**
 * Deterministic query expansion for syllabus domain concepts.
 * Handles common abbreviations and technical synonyms (e.g. 2NF <-> Second Normal Form)
 * without altering retrieval intent.
 */
export function expandRetrievalQuery(query: string): string {
  let expanded = query;
  const lower = query.toLowerCase();

  const expansions: Array<{ pattern: RegExp; terms: string }> = [
    { pattern: /\b(1nf|1st\s+normal\s+form)\b/i, terms: "first normal form" },
    { pattern: /\bfirst\s+normal\s+form\b/i, terms: "1nf" },
    { pattern: /\b(2nf|2nd\s+normal\s+form)\b/i, terms: "second normal form" },
    { pattern: /\bsecond\s+normal\s+form\b/i, terms: "2nf" },
    { pattern: /\b(3nf|3rd\s+normal\s+form)\b/i, terms: "third normal form" },
    { pattern: /\bthird\s+normal\s+form\b/i, terms: "3nf" },
    { pattern: /\b(bcnf|boyce[- ]codd(\s+normal\s+form)?)\b/i, terms: "boyce codd normal form bcnf" },
    { pattern: /\b(acid(\s+properties)?)\b/i, terms: "atomicity consistency isolation durability" },
    { pattern: /\b(partial\s+(functional\s+)?dependenc(y|ies))\b/i, terms: "2nf second normal form" },
  ];

  for (const { pattern, terms } of expansions) {
    if (pattern.test(lower)) {
      expanded += ` ${terms}`;
    }
  }

  return expanded.replace(/\s+/g, " ").trim();
}

/**
 * Build a BM25 index from an array of chunks and implement `Retriever`.
 * The index is immutable after construction.
 */
export class Bm25Retriever implements Retriever {
  private readonly entries: IndexEntry[];
  /** term → number of documents containing it */
  private readonly df: Map<string, number>;
  private readonly N: number;
  private readonly avgdl: number;

  constructor(chunks: SourceChunk[]) {
    this.entries = chunks.map((chunk) => {
      const tokens = tokenise(`${chunk.heading} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) ?? 0) + 1);
      }
      return { chunk, tf, length: tokens.length };
    });

    this.df = new Map<string, number>();
    for (const entry of this.entries) {
      for (const term of entry.tf.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }

    this.N = this.entries.length;
    this.avgdl =
      this.N === 0
        ? 0
        : this.entries.reduce((s, e) => s + e.length, 0) / this.N;
  }

  async search(
    query: string,
    limit: number,
    documentId?: string,
  ): Promise<Array<{ chunk: SourceChunk; score: number }>> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const expanded = expandRetrievalQuery(trimmed);
    const queryTerms = tokenise(expanded);
    if (queryTerms.length === 0) return [];

    const candidateEntries = documentId
      ? this.entries.filter((entry) => entry.chunk.documentId === documentId)
      : this.entries;

    const scored = candidateEntries.map((entry) => {
      let score = 0;
      for (const term of queryTerms) {
        const df = this.df.get(term) ?? 0;
        if (df === 0) continue;
        const tf = entry.tf.get(term) ?? 0;
        if (tf === 0) continue;

        // IDF — add 1 to avoid division-by-zero when df === N
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));

        // BM25 term frequency saturation
        const norm =
          entry.length === 0
            ? 0
            : (tf * (K1 + 1)) /
              (tf + K1 * (1 - B + B * (entry.length / (this.avgdl || 1))));

        score += idf * norm;
      }
      return { chunk: entry.chunk, score };
    });

    return scored
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
