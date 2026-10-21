import { FileText, ShieldCheck, AlertOctagon, Sparkles, HelpCircle, FileQuestion, BookOpen } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { Panel } from "./Panel";
import type { EvidenceData } from "../lib/api-client";
import { formatConceptOrChunkTitle } from "../lib/topic-utils";

export interface HighlightResult {
  before: string;
  highlighted: string;
  after: string;
  offsetStatus: "exact" | "recovered" | "fallback";
}

/**
 * Pure, safe evidence offset validator and span extractor.
 * Handles exact offsets, recovered substring offsets, missing context,
 * out-of-bounds offsets, and special characters without throwing.
 */
export function renderHighlightedEvidence(
  sourceContext: string | undefined,
  quote: string,
  start?: number,
  end?: number,
): HighlightResult {
  if (!quote) {
    return { before: "", highlighted: "", after: "", offsetStatus: "fallback" };
  }

  if (!sourceContext || sourceContext.trim().length === 0) {
    return { before: "", highlighted: quote, after: "", offsetStatus: "fallback" };
  }

  // 1. Try exact validated offsets
  if (
    typeof start === "number" &&
    typeof end === "number" &&
    !Number.isNaN(start) &&
    !Number.isNaN(end) &&
    start >= 0 &&
    end > start &&
    end <= sourceContext.length
  ) {
    const candidate = sourceContext.slice(start, end);
    if (candidate === quote) {
      return {
        before: sourceContext.slice(0, start),
        highlighted: quote,
        after: sourceContext.slice(end),
        offsetStatus: "exact",
      };
    }
  }

  // 2. Offsets missing, shifted, or invalid: fallback to robust physical substring match
  const idx = sourceContext.indexOf(quote);
  if (idx >= 0) {
    return {
      before: sourceContext.slice(0, idx),
      highlighted: quote,
      after: sourceContext.slice(idx + quote.length),
      offsetStatus: "recovered",
    };
  }

  // 3. Substring not found in context (e.g. truncated passage): fallback safely to quote itself
  return {
    before: "",
    highlighted: quote,
    after: "",
    offsetStatus: "fallback",
  };
}

/**
 * Renders surrounding context text cleanly, styling decorative ASCII divider bars
 * (e.g. `===...===` or `---...---`) into clean separator lines without altering
 * original text tokens or character offsets.
 */
function renderPassageText(text: string) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  return lines.map((line, idx) => {
    const isDivider = /^[=\-#~*_]{4,}\s*$/.test(line.trim());
    if (isDivider) {
      return <span key={idx} className="block my-1.5 h-px bg-stone-800/80" aria-hidden="true" />;
    }
    return (
      <span key={idx}>
        {line}
        {idx < lines.length - 1 ? "\n" : ""}
      </span>
    );
  });
}

interface EvidenceCardProps {
  evidence?: EvidenceData;
  recoveryCitation?: EvidenceData;
  isLoading?: boolean;
  activeDocumentTitle?: string;
  onExplainSimply?: () => void;
  onGiveExample?: () => void;
  onQuizMe?: () => void;
}

export function EvidenceCard({
  evidence,
  recoveryCitation,
  isLoading,
  activeDocumentTitle,
  onExplainSimply,
  onGiveExample,
  onQuizMe,
}: EvidenceCardProps) {
  const displayEvidence = recoveryCitation || evidence;
  const isRecovery = Boolean(recoveryCitation);
  const isVerified = displayEvidence?.status === "verified";
  const badge = isRecovery
    ? "Misconception note citation"
    : isVerified
      ? "Verified quote"
      : displayEvidence?.status === "rejected"
        ? "Rejected quote"
        : undefined;

  const panelTitle = isRecovery
    ? "Note evidence to correct misunderstanding"
    : "Why is this answer correct?";

  const { before, highlighted, after, offsetStatus } = displayEvidence
    ? renderHighlightedEvidence(
        displayEvidence.sourceContext,
        displayEvidence.quote,
        displayEvidence.start,
        displayEvidence.end,
      )
    : { before: "", highlighted: "", after: "", offsetStatus: "fallback" as const };

  const hasSurroundingContext = before.length > 0 || after.length > 0;

  return (
    <Panel
      title={panelTitle}
      badge={badge}
      icon={<FileText className="size-4 text-emerald-400" />}
    >
      {isLoading ? (
        <div className="py-5 text-center text-xs sm:text-sm text-amber-300/80">
          <p className="animate-pulse">Retrieving and verifying note evidence…</p>
        </div>
      ) : !displayEvidence ? (
        <EmptyState title="No evidence quotation yet">
          A quotation will appear here only after the server confirms that it physically occurs in the cited note.
        </EmptyState>
      ) : isVerified ? (
        <div className="space-y-3.5">
          {/* Header Metadata: Source Document & Section Heading */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-stone-300 font-medium min-w-0">
              <BookOpen className="size-3.5 text-amber-400 shrink-0" />
              <span className="text-stone-400">Source:</span>
              <span className="text-stone-200 font-semibold max-w-[180px] sm:max-w-[220px] truncate" title={activeDocumentTitle || "Study Notes"}>
                {activeDocumentTitle || "Study Notes"}
              </span>
              <span className="text-stone-500">•</span>
              <span className="font-medium text-emerald-400 truncate max-w-[200px]" title={displayEvidence.chunkId}>
                {formatConceptOrChunkTitle(displayEvidence.chunkId)}
              </span>
            </div>
          </div>

          {/* Interactive Source Passage Inspector */}
          <div
            className="relative rounded-xl border border-emerald-500/30 bg-[#111613] p-4 shadow-lg transition-all"
            data-testid="source-evidence-inspector"
          >
            {hasSurroundingContext ? (
              <div className="text-xs sm:text-sm font-sans leading-relaxed text-stone-300 whitespace-pre-wrap break-words overflow-hidden">
                <span className="text-stone-400/90 select-text">{renderPassageText(before)}</span>
                <mark
                  data-testid="evidence-highlight-span"
                  className="bg-amber-400/25 text-amber-200 border-b-2 border-amber-400 font-semibold px-1 py-0.5 rounded-sm select-text inline"
                >
                  {highlighted}
                </mark>
                <span className="text-stone-400/90 select-text">{renderPassageText(after)}</span>
              </div>
            ) : (
              <blockquote className="text-xs sm:text-sm font-serif italic leading-relaxed text-stone-100 select-text break-words">
                &ldquo;{highlighted}&rdquo;
              </blockquote>
            )}

            {/* Secondary Provenance & Verified Offset Details */}
            {displayEvidence.start !== undefined && displayEvidence.end !== undefined && (
              <details className="mt-2.5 pt-2 border-t border-emerald-500/15 text-[10px] text-stone-400 font-mono">
                <summary className="cursor-pointer hover:text-stone-300 select-none transition-colors">
                  Technical Provenance · Offsets: chars {displayEvidence.start}–{displayEvidence.end} ({offsetStatus} match)
                </summary>
                <div className="mt-1 pl-2 border-l border-stone-800 text-[10px] text-stone-400 space-y-0.5">
                  <p>Chunk ID: <code className="text-emerald-400/90 break-all">{displayEvidence.chunkId}</code></p>
                  <p>Character Spans: physical offset {displayEvidence.start} to {displayEvidence.end} in source text</p>
                </div>
              </details>
            )}

            <div className="mt-2.5 pt-2 border-t border-emerald-500/15 flex items-center justify-between text-[11px] text-emerald-400/90 font-medium">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                <span>Supporting passage verified against the document</span>
              </div>
              {hasSurroundingContext && (
                <span className="text-[10px] text-stone-400 font-mono hidden sm:inline">
                  Interactive Context
                </span>
              )}
            </div>
          </div>

          {/* Interactive Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] font-medium text-stone-400 mr-1">Actions:</span>
            <button
              type="button"
              onClick={onExplainSimply}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-200 border border-stone-800 hover:border-stone-700 transition-colors shadow-sm"
              title="Explain this verified evidence in simpler terms"
            >
              <Sparkles className="size-3 text-amber-400" />
              <span>Explain simply</span>
            </button>
            <button
              type="button"
              onClick={onGiveExample}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-stone-900 hover:bg-stone-800 text-stone-200 border border-stone-800 hover:border-stone-700 transition-colors shadow-sm"
              title="Request an illustrative example grounded in this concept"
            >
              <HelpCircle className="size-3 text-cyan-400" />
              <span>Give an example</span>
            </button>
            <button
              type="button"
              onClick={onQuizMe}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-stone-900 hover:bg-stone-800 text-amber-300 border border-amber-500/30 hover:border-amber-500/60 transition-colors shadow-sm"
              title="Test yourself on this specific verified concept"
            >
              <FileQuestion className="size-3 text-amber-400" />
              <span>Quiz me</span>
            </button>
          </div>
        </div>
      ) : (
        <div
          className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3.5 text-xs text-rose-300 flex items-start gap-2.5"
          role="alert"
        >
          <AlertOctagon className="size-4 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Quotation Rejected</p>
            <p className="mt-1 text-[11px] text-rose-300/80 leading-relaxed">
              The claimed passage could not be verified in chunk{" "}
              <code className="font-mono text-rose-200" title={displayEvidence.chunkId}>
                [{formatConceptOrChunkTitle(displayEvidence.chunkId)}]
              </code>
              .
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
