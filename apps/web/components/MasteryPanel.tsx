"use client";

import { Brain, Zap, RotateCcw, AlertTriangle } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { Panel } from "./Panel";
import type { MasteryConcept } from "../lib/api-client";
import { formatConceptOrChunkTitle } from "../lib/topic-utils";

interface MasteryPanelProps {
  masteryList?: MasteryConcept[];
  onReviewWeak?: () => void;
  onSelectConcept?: (conceptId: string) => void;
  onStartChallenge?: () => void;
  isLoading?: boolean;
  className?: string;
}

export function MasteryPanel({
  masteryList,
  onReviewWeak,
  onSelectConcept,
  onStartChallenge,
  isLoading,
  className,
}: MasteryPanelProps) {
  const hasConcepts = Boolean(masteryList && masteryList.length > 0);
  const hasAttempts = Boolean(masteryList && masteryList.some((m) => m.attemptsCount > 0));
  const hasWeakConcepts =
    masteryList &&
    masteryList.some((m) => m.openMisconceptions.length > 0 || (m.attemptsCount > 0 && m.mastery < 0.5));

  return (
    <Panel
      title="Mastery"
      badge="Persisted (SQLite)"
      icon={<Brain className="size-4 text-amber-400" />}
      className={`flex flex-col min-h-0 ${className || ""}`}
    >
      {isLoading && (!masteryList || masteryList.length === 0) ? (
        <div className="py-5 text-center text-xs sm:text-sm text-amber-300/80">
          <p className="animate-pulse">Loading persisted mastery…</p>
        </div>
      ) : !hasConcepts ? (
        <EmptyState title="No progress recorded">
          After you answer questions, each concept’s mastery and any open misconceptions will be listed here.
        </EmptyState>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 space-y-3">
          {!hasAttempts && (
            <p className="text-[11px] text-stone-400 italic bg-stone-900/60 border border-stone-800/80 rounded-xl p-2.5 shrink-0">
              Syllabus concepts ready. Answer questions to record attempts and track mastery progress.
            </p>
          )}

          {hasWeakConcepts && (
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-2.5 shrink-0">
              <span className="text-[11px] font-medium text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-amber-400 shrink-0" />
                <span>You have concepts flagged for review.</span>
              </span>
              <div className="flex items-center gap-1.5 self-end sm:self-auto">
                {onReviewWeak && (
                  <button
                    type="button"
                    onClick={onReviewWeak}
                    className="inline-flex items-center gap-1 rounded bg-amber-700/80 hover:bg-amber-700 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors"
                  >
                    <RotateCcw className="size-3" />
                    <span>Retest</span>
                  </button>
                )}
                {onStartChallenge && (
                  <button
                    type="button"
                    onClick={onStartChallenge}
                    className="inline-flex items-center gap-1 rounded bg-gradient-to-r from-amber-500 to-orange-600 px-2.5 py-1 text-[11px] font-semibold text-stone-950 hover:opacity-95 transition-all shadow-sm"
                  >
                    <Zap className="size-3 fill-stone-950" />
                    <span>Rapid-Fire</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bounded Concept List Container */}
          <div className="flex-1 min-h-[140px] max-h-[380px] overflow-y-auto pr-1">
            <ul className="divide-y divide-stone-800/70 text-xs" aria-label="Concept mastery list">
              {masteryList!.map((m) => {
                const percentage = Math.round(m.mastery * 100);
                const isWeak = m.openMisconceptions.length > 0 || (m.attemptsCount > 0 && m.mastery < 0.5);

                return (
                  <li
                    key={m.conceptId}
                    className="py-2 first:pt-0 last:pb-0 flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectConcept && onSelectConcept(m.conceptId)}
                        className="font-medium text-stone-200 hover:text-amber-400 text-left cursor-pointer transition-colors flex items-center gap-1.5"
                        title={m.conceptId}
                      >
                        <span className="font-mono text-xs">{formatConceptOrChunkTitle(m.conceptId)}</span>
                        {isWeak && (
                          <span className="text-[9px] text-rose-300 font-bold bg-rose-500/20 border border-rose-500/30 px-1 py-0.2 rounded uppercase">
                            Review
                          </span>
                        )}
                      </button>
                      <span className="text-stone-400 text-[11px]">
                        {m.attemptsCount === 0 ? (
                          <span className="italic text-stone-500">Not assessed</span>
                        ) : (
                          `${m.attemptsCount} ${m.attemptsCount === 1 ? "attempt" : "attempts"} · `
                        )}
                        <span className="font-semibold text-stone-100 font-mono ml-1">{percentage}%</span>
                      </span>
                    </div>

                    {/* Progress bar track & fill */}
                    <div className="bg-stone-950 border border-stone-800/70 h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-700 rounded-full ${
                          m.mastery >= 0.8
                            ? "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                            : m.mastery >= 0.4
                              ? "bg-gradient-to-r from-amber-500 to-yellow-400 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                              : "bg-gradient-to-r from-orange-600 to-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>

                    {/* Open misconceptions */}
                    {m.openMisconceptions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {m.openMisconceptions.map((label) => (
                          <span
                            key={label}
                            className="inline-flex items-center gap-1 rounded bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.2 text-[10px] font-mono text-rose-300"
                          >
                            ⚠ {label}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="pt-1.5 border-t border-stone-800/70 text-[10px] text-stone-400 flex justify-between">
            <span>Competency score (0–100%)</span>
            <span>SQLite active</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
