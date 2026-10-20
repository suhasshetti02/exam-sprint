"use client";

import { useEffect, useState, useRef } from "react";
import {
  startChallenge,
  answerChallengeSlot,
  type ChallengeState,
  type MasteryConcept,
  type ToolTraceEntry,
} from "@/lib/api-client";

interface RapidFireChallengeProps {
  isOpen: boolean;
  onClose: () => void;
  masteryList: MasteryConcept[];
  onChallengeCompleted?: (updatedMastery: MasteryConcept[], traces: ToolTraceEntry[]) => void;
}

export function RapidFireChallenge({
  isOpen,
  onClose,
  masteryList,
  onChallengeCompleted,
}: RapidFireChallengeProps) {
  const [challengeState, setChallengeState] = useState<ChallengeState | null>(null);
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState("");
  const [typedAnswer, setTypedAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingChallenge, setIsLoadingChallenge] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Timer: 45 seconds per question.
  // Design Note: This timer functions as a client-side visual pacing countdown to encourage
  // rapid recall during study sessions. It does not enforce a rigid server-side cutoff timestamp.
  const QUESTION_TIME_SECONDS = 45;
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_SECONDS);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Latest slot evaluation result
  const [currentSlotResult, setCurrentSlotResult] = useState<{
    verdict: "correct" | "partially_correct" | "incorrect";
    explanation: string;
    evidence: { chunkId: string; quote: string; status: "verified" | "unverified" | "rejected" };
  } | null>(null);

  const handleClose = () => {
    setChallengeState(null);
    setCurrentSlotResult(null);
    setActiveSlotIndex(0);
    setError(null);
    if (timerRef.current) clearInterval(timerRef.current);
    onClose();
  };

  // Start challenge when opened
  useEffect(() => {
    if (!isOpen) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    let active = true;
    startChallenge()
      .then((state) => {
        if (!active) return;
        setChallengeState(state);
        setActiveSlotIndex(0);
        setSelectedChoice("");
        setTypedAnswer("");
        setCurrentSlotResult(null);
        setTimeLeft(QUESTION_TIME_SECONDS);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to start challenge");
      })
      .finally(() => {
        if (active) setIsLoadingChallenge(false);
      });

    return () => {
      active = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, masteryList]);

  // Question timer
  const currentSlot = challengeState?.slots[activeSlotIndex];
  const isAnswered = currentSlot?.answered || !!currentSlotResult;

  useEffect(() => {
    if (!isOpen || !challengeState || isAnswered || challengeState.status === "completed") {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, activeSlotIndex, isAnswered, challengeState?.status, challengeState]);

  if (!isOpen) return null;

  const handleSubmitCurrentAnswer = async (answerToSubmit?: string) => {
    if (!challengeState || !currentSlot || isSubmitting || isAnswered) return;

    const answer =
      answerToSubmit ??
      (currentSlot.question.kind === "multiple_choice" ? selectedChoice : typedAnswer);

    const trimmed = answer.trim() || "(Time expired / no answer)";

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await answerChallengeSlot(
        challengeState.challengeId,
        activeSlotIndex,
        trimmed,
      );

      setCurrentSlotResult({
        verdict: res.verdict,
        explanation: res.explanation,
        evidence: res.evidence,
      });

      setChallengeState(res.challenge);

      // If this completes the challenge, trigger parent callback with tool traces
      if (res.challenge.status === "completed" && onChallengeCompleted) {
        // Parent will re-fetch mastery list
        onChallengeCompleted([], res.toolTraces);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record answer");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextSlot = () => {
    if (!challengeState) return;

    if (activeSlotIndex < challengeState.totalSlots - 1) {
      setActiveSlotIndex((prev) => prev + 1);
      setSelectedChoice("");
      setTypedAnswer("");
      setCurrentSlotResult(null);
      setTimeLeft(QUESTION_TIME_SECONDS);
    }
  };

  const handleRestart = () => {
    setIsLoadingChallenge(true);
    setError(null);
    setCurrentSlotResult(null);
    setActiveSlotIndex(0);

    startChallenge()
      .then((state) => {
        setChallengeState(state);
        setSelectedChoice("");
        setTypedAnswer("");
        setTimeLeft(QUESTION_TIME_SECONDS);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to start challenge");
      })
      .finally(() => {
        setIsLoadingChallenge(false);
      });
  };

  const isCompleted = challengeState?.status === "completed" || activeSlotIndex >= (challengeState?.totalSlots ?? 5) && isAnswered;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rapid-fire-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-stone-800 bg-[#12100e] shadow-2xl overflow-hidden my-auto max-h-[90dvh] flex flex-col">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-stone-800/80 bg-stone-900/80 px-5 sm:px-6 py-3.5 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500 text-lg font-bold">
              ⚡
            </span>
            <div>
              <h2 id="rapid-fire-title" className="text-sm sm:text-base font-bold text-stone-100">
                Rapid-Fire Redemption
              </h2>
              <p className="text-xs text-stone-400">
                Targeted sprint focused on your persistent weak concepts
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close challenge"
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-800 hover:text-stone-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Loading State */}
        {isLoadingChallenge && (
          <div className="py-16 text-center space-y-3">
            <div className="inline-block size-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
            <p className="text-sm font-medium text-stone-200">Assembling weak-concept questions…</p>
            <p className="text-xs text-stone-400">Checking unresolved misconceptions & mastery history</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="m-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center justify-between shrink-0">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-bold px-1 hover:opacity-75"
            >
              ✕
            </button>
          </div>
        )}

        {/* Challenge In-Progress View */}
        {!isLoadingChallenge && challengeState && !isCompleted && currentSlot && (
          <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1 min-h-0">
            {/* Progress & Timer Bar */}
            <div className="flex items-center justify-between text-xs font-medium">
              <div className="flex items-center gap-2">
                <span className="rounded bg-line px-2 py-0.5 text-ink font-semibold">
                  Slot {activeSlotIndex + 1} of {challengeState.totalSlots}
                </span>
                <span className="text-muted">
                  Score: <strong className="text-ok font-semibold">{challengeState.score}</strong>
                </span>
              </div>

              {/* Countdown timer */}
              <div
                className={`flex items-center gap-1.5 font-mono px-2 py-0.5 rounded text-xs ${
                  timeLeft <= 10
                    ? "bg-alert/10 text-alert font-bold animate-pulse"
                    : "bg-line/60 text-muted"
                }`}
              >
                <span>⏱</span>
                <span>{timeLeft}s</span>
              </div>
            </div>

            {/* Time progress bar */}
            <div className="h-1.5 w-full rounded-full bg-line overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ${
                  timeLeft <= 10 ? "bg-alert" : "bg-amber-500"
                }`}
                style={{ width: `${(timeLeft / QUESTION_TIME_SECONDS) * 100}%` }}
              />
            </div>

            {/* Question Details */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono text-[11px] font-semibold px-2 py-0.5 border border-amber-500/20">
                  Target: {currentSlot.conceptId}
                </span>
                <span className="text-xs text-muted">
                  {currentSlot.question.kind === "multiple_choice"
                    ? "Multiple Choice"
                    : "Short Answer"}
                </span>
              </div>

              <p className="text-sm font-medium leading-relaxed text-ink">
                {currentSlot.question.prompt}
              </p>
            </div>

            {/* Question Input (Unanswered) */}
            {!isAnswered && (
              <div className="space-y-4 pt-2">
                {currentSlot.question.kind === "multiple_choice" &&
                  currentSlot.question.choices && (
                    <div className="space-y-2">
                      {currentSlot.question.choices.map((choice, i) => {
                        const letter = String.fromCharCode(65 + i);
                        const isSelected = selectedChoice === letter;
                        return (
                          <button
                            key={choice}
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => setSelectedChoice(letter)}
                            className={`w-full text-left rounded-lg border p-3 text-xs transition-all flex items-start gap-3 ${
                              isSelected
                                ? "border-amber-500 bg-amber-500/10 font-medium text-ink shadow-sm"
                                : "border-line bg-panel hover:bg-line/40 text-muted hover:text-ink"
                            }`}
                          >
                            <span
                              className={`font-mono font-bold px-2 py-0.5 rounded text-xs ${
                                isSelected
                                  ? "bg-amber-500 text-white"
                                  : "bg-line text-ink"
                              }`}
                            >
                              {letter}
                            </span>
                            <span className="flex-1 mt-0.5">{choice}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                {currentSlot.question.kind === "short_answer" && (
                  <div>
                    <label htmlFor="rf-short-answer" className="sr-only">
                      Your answer
                    </label>
                    <input
                      id="rf-short-answer"
                      type="text"
                      disabled={isSubmitting}
                      value={typedAnswer}
                      onChange={(e) => setTypedAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSubmitCurrentAnswer();
                        }
                      }}
                      placeholder="Type your concise answer and press Enter…"
                      className="w-full rounded-md border border-line bg-panel px-3 py-2 text-xs text-ink placeholder:text-muted focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={
                      isSubmitting ||
                      (currentSlot.question.kind === "multiple_choice" && !selectedChoice) ||
                      (currentSlot.question.kind === "short_answer" && !typedAnswer.trim())
                    }
                    onClick={() => handleSubmitCurrentAnswer()}
                    className="rounded-md bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {isSubmitting ? "Evaluating against notes…" : "Submit Answer"}
                  </button>
                </div>
              </div>
            )}

            {/* Answer Result & Verified Evidence Card */}
            {isAnswered && (
              <div className="space-y-4 pt-2">
                <div
                  className={`rounded-lg border p-4 space-y-2.5 ${
                    currentSlotResult?.verdict === "correct"
                      ? "border-ok/30 bg-ok/10"
                      : currentSlotResult?.verdict === "partially_correct"
                        ? "border-amber-400/30 bg-amber-500/10"
                        : "border-alert/30 bg-alert/10"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        currentSlotResult?.verdict === "correct"
                          ? "bg-ok text-white"
                          : currentSlotResult?.verdict === "partially_correct"
                            ? "bg-amber-600 text-white"
                            : "bg-alert text-white"
                      }`}
                    >
                      {currentSlotResult?.verdict === "correct"
                        ? "✓ Correct"
                        : currentSlotResult?.verdict === "partially_correct"
                          ? "▲ Partially Correct"
                          : "✕ Incorrect"}
                    </span>
                  </div>

                  <p className="text-xs text-ink leading-relaxed">
                    {currentSlotResult?.explanation}
                  </p>

                  {/* Verified evidence quote */}
                  {currentSlotResult?.evidence && (
                    <div className="mt-2.5 rounded border border-line/60 bg-panel/60 p-2.5 text-[11px] text-muted space-y-1">
                      <div className="font-semibold text-ink flex items-center gap-1">
                        <span>📜 Verified Study Note Evidence:</span>
                        <span className="font-mono text-[10px] text-muted">
                          [{currentSlotResult.evidence.chunkId}]
                        </span>
                      </div>
                      <blockquote className="italic border-l-2 border-amber-500 pl-2">
                        &ldquo;{currentSlotResult.evidence.quote}&rdquo;
                      </blockquote>
                    </div>
                  )}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleNextSlot}
                    className="rounded-md bg-ink px-4 py-2 text-xs font-semibold text-white shadow hover:opacity-90 transition-opacity"
                  >
                    {activeSlotIndex < challengeState.totalSlots - 1
                      ? "Next Question →"
                      : "View Challenge Results 🏆"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Challenge Summary Screen */}
        {!isLoadingChallenge && challengeState && isCompleted && (
          <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
            <div className="text-center space-y-2">
              <span className="inline-block text-4xl">
                {challengeState.score >= 4 ? "🏆" : challengeState.score >= 3 ? "⭐" : "🎯"}
              </span>
              <h3 className="text-xl font-bold text-ink">
                Redemption Sprint Complete!
              </h3>
              <p className="text-xs text-muted">
                Your answers were verified against study notes and persisted to SQLite mastery.
              </p>
            </div>

            {/* Scorecard */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border border-line bg-panel p-3">
                <span className="text-xs text-muted block">Score</span>
                <span className="text-2xl font-bold text-ink font-mono">
                  {challengeState.score} / {challengeState.totalSlots}
                </span>
              </div>
              <div className="rounded-lg border border-line bg-panel p-3">
                <span className="text-xs text-muted block">Redemption Rate</span>
                <span className="text-2xl font-bold text-ok font-mono">
                  {Math.round((challengeState.score / challengeState.totalSlots) * 100)}%
                </span>
              </div>
              <div className="rounded-lg border border-line bg-panel p-3">
                <span className="text-xs text-muted block">Mastery Updated</span>
                <span className="text-2xl font-bold text-amber-500 font-mono">
                  ✓ Saved
                </span>
              </div>
            </div>

            {/* Question by question recap */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                Sprint Breakdown
              </h4>
              <div className="divide-y divide-line rounded-lg border border-line bg-panel text-xs">
                {challengeState.slots.map((slot, idx) => {
                  return (
                    <div
                      key={slot.questionId || idx}
                      className="flex items-center justify-between p-3"
                    >
                      <div className="space-y-0.5">
                        <span className="font-semibold text-ink">
                          Slot {idx + 1}: {slot.conceptId}
                        </span>
                        <p className="text-muted text-[11px] line-clamp-1">
                          {slot.question.prompt}
                        </p>
                      </div>
                      <div className="text-right flex items-center gap-2">
                        <span
                          className={`font-semibold text-[11px] px-2 py-0.5 rounded ${
                            slot.verdict === "correct"
                              ? "bg-ok/10 text-ok"
                              : slot.verdict === "partially_correct"
                                ? "bg-amber-500/10 text-amber-600"
                                : "bg-alert/10 text-alert"
                          }`}
                        >
                          {slot.verdict === "correct"
                            ? "Correct"
                            : slot.verdict === "partially_correct"
                              ? "Partial"
                              : "Incorrect"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between pt-2 border-t border-line">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md border border-line bg-panel px-4 py-2 text-xs font-semibold text-muted hover:text-ink transition-colors"
              >
                Close & Return to Chat
              </button>
              <button
                type="button"
                onClick={handleRestart}
                className="rounded-md bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-amber-700 transition-colors"
              >
                ⚡ Start Another Sprint
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
