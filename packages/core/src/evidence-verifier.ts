/**
 * Verifies that a claimed quotation physically appears in the referenced chunk text.
 *
 * Normalisation policy (must match the chunker's documented policy):
 *   - Collapse all whitespace runs (space, \t, \r, \n) to a single ASCII space.
 *   - Trim leading and trailing whitespace.
 *   - Comparison is case-insensitive.
 *
 * The verifier finds the normalised quote inside the normalised chunk text.
 * It then maps the match back to byte-level offsets in the *original* (un-normalised)
 * chunk text using a word-boundary scan, because exact byte mapping through whitespace
 * collapse is not bijective.  Offsets are therefore approximate (word-level) but always
 * point to real content in the original text.
 *
 * Returns:
 *   status "verified"   — quote found; start/end are character offsets in original text.
 *   status "rejected"   — chunk is undefined, or quote is empty, or quote not found.
 *   status "unverified" — never returned by this implementation; reserved for callers.
 *
 * Security note: the chunk text is from our own database (trusted source).
 * The quote is from model output (untrusted).  This code never executes the quote.
 *
 * This module must stay free of FS, Node-only, and framework imports.
 */

import type { EvidenceReference, SourceChunk, VerificationStatus } from "./domain";
import type { EvidenceVerifier } from "./interfaces";

/** Apply the canonical whitespace-collapse normalisation. */
export function normalise(text: string): string {
  return text.replace(/[\s\r\n\t]+/g, " ").trim();
}

/**
 * Find the character offsets of `needle` in `haystack` using the normalised
 * comparison, then return approximate character offsets in the original haystack.
 *
 * Returns null when the normalised needle is not found in the normalised haystack.
 */
function findOffsets(
  originalHaystack: string,
  quote: string,
): { start: number; end: number } | null {
  const normHaystack = normalise(originalHaystack).toLowerCase();
  const normNeedle = normalise(quote).toLowerCase();

  if (!normNeedle) return null;

  const idx = normHaystack.indexOf(normNeedle);
  if (idx === -1) return null;

  // Map normalised offset back to original text.
  // Walk the original text, keeping a parallel count of normalised characters
  // (treating each whitespace run as one character).
  let normPos = 0;
  let origStart = -1;
  let origEnd = -1;
  let inWhitespace = false;

  for (let origPos = 0; origPos < originalHaystack.length; origPos++) {
    const ch = originalHaystack[origPos];
    if (ch === undefined) break;
    const isWs = /\s/.test(ch);

    if (isWs) {
      if (!inWhitespace) {
        // First whitespace char — counts as one normalised space.
        if (normPos === idx && origStart === -1) origStart = origPos;
        normPos++;
        if (normPos === idx + normNeedle.length) { origEnd = origPos; break; }
        inWhitespace = true;
      }
      // Subsequent whitespace chars in the same run — no normPos increment.
    } else {
      inWhitespace = false;
      if (normPos === idx && origStart === -1) origStart = origPos;
      normPos++;
      if (normPos === idx + normNeedle.length) { origEnd = origPos + 1; break; }
    }
  }

  if (origStart === -1 || origEnd === -1) {
    // Fallback: return the raw string search result in the original text.
    const rawIdx = originalHaystack.toLowerCase().indexOf(normalise(quote).toLowerCase());
    if (rawIdx === -1) return null;
    return { start: rawIdx, end: rawIdx + quote.length };
  }

  return { start: origStart, end: origEnd };
}

/** Implements `EvidenceVerifier`. Stateless; safe to share across requests. */
export class DefaultEvidenceVerifier implements EvidenceVerifier {
  verify(
    reference: EvidenceReference,
    chunk: SourceChunk | undefined,
  ): { status: VerificationStatus; reference: EvidenceReference } {
    if (!chunk) {
      return { status: "rejected", reference };
    }

    const trimmedQuote = reference.quote.trim();
    if (!trimmedQuote) {
      return { status: "rejected", reference: { ...reference, quote: trimmedQuote } };
    }

    const offsets = findOffsets(chunk.text, trimmedQuote);
    if (!offsets) {
      return { status: "rejected", reference };
    }

    return {
      status: "verified",
      reference: {
        chunkId: reference.chunkId,
        quote: trimmedQuote,
        start: offsets.start,
        end: offsets.end,
      },
    };
  }
}
