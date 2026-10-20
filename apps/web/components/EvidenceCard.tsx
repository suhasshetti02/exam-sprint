import { FileText, ShieldCheck, AlertOctagon } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { Panel } from "./Panel";
import type { EvidenceData } from "../lib/api-client";
import { formatConceptOrChunkTitle } from "../lib/topic-utils";

interface EvidenceCardProps {
  evidence?: EvidenceData;
  recoveryCitation?: EvidenceData;
  isLoading?: boolean;
}

export function EvidenceCard({ evidence, recoveryCitation, isLoading }: EvidenceCardProps) {
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

  return (
    <Panel
      title={isRecovery ? "Note evidence to correct misunderstanding" : "Evidence from your notes"}
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
        <div className="space-y-3">
          <div className="relative rounded-r-xl rounded-l-md border-l-4 border-l-emerald-500 border border-emerald-500/20 bg-[#131916] p-4 shadow-md">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-emerald-300" title={displayEvidence.chunkId}>
                <ShieldCheck className="size-3.5 text-emerald-400" />
                <span>✔ {formatConceptOrChunkTitle(displayEvidence.chunkId)}</span>
              </span>
              {displayEvidence.start !== undefined && displayEvidence.end !== undefined && (
                <span className="text-[10px] font-mono bg-stone-900/90 text-amber-300/90 px-2 py-0.5 rounded-md border border-amber-500/20">
                  Offsets: chars {displayEvidence.start}–{displayEvidence.end}
                </span>
              )}
            </div>

            <blockquote className="text-xs sm:text-sm font-serif italic leading-relaxed text-stone-100">
              &ldquo;{displayEvidence.quote}&rdquo;
            </blockquote>
          </div>

          <p className="text-[11px] text-emerald-400 font-medium flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            <span>Verified substring match against original study notes.</span>
          </p>
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
              <code className="font-mono text-rose-200" title={displayEvidence.chunkId}>[{formatConceptOrChunkTitle(displayEvidence.chunkId)}]</code>.
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}
