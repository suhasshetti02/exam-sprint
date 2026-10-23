"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, XCircle, ArrowRight, HelpCircle, SkipForward, Repeat2, Lightbulb, BookOpen, ListChecks, MessageSquareText } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { Panel } from "./Panel";
import type { EvaluationData, QuestionData } from "../lib/api-client";
import { formatConceptOrChunkTitle } from "../lib/topic-utils";

interface QuizCardProps {
  question?: QuestionData;
  evaluation?: EvaluationData;
  onSubmitAnswer?: (answer: string) => void;
  onNextQuestion?: () => void;
  isLoading?: boolean;
  selectedOption?: string;
  progressionMode?: "guided" | "automatic";
  autoAdvanceCountdown?: number | null;
  onCancelAutoAdvance?: () => void;
  onSkipQuestion?: () => void;
  onRepeatQuestion?: () => void;
  onExplainConcept?: () => void;
  onGiveHint?: () => void;
  onRequestMultipleChoice?: () => void;
  onRequestShortAnswer?: () => void;
}

export function QuizCard({
  question,
  evaluation,
  onSubmitAnswer,
  onNextQuestion,
  isLoading,
  selectedOption,
  progressionMode = "guided",
  autoAdvanceCountdown,
  onCancelAutoAdvance,
  onSkipQuestion,
  onRepeatQuestion,
  onExplainConcept,
  onGiveHint,
  onRequestMultipleChoice,
  onRequestShortAnswer,
}: QuizCardProps) {
  const [prevQuestionId, setPrevQuestionId] = useState(question?.questionId);
  const [selectedAnswer, setSelectedAnswer] = useState(selectedOption || "");
  const [typedAnswer, setTypedAnswer] = useState("");

  // Sync with externally selected option (e.g. from speech recognition)
  if (selectedOption && selectedOption !== selectedAnswer && !evaluation) {
    setSelectedAnswer(selectedOption);
  }

  // Reset inputs during render when the question changes without cascading effect renders
  if (prevQuestionId !== question?.questionId) {
    setPrevQuestionId(question?.questionId);
    setSelectedAnswer(selectedOption || "");
    setTypedAnswer("");
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const answer = question?.kind === "multiple_choice" ? selectedAnswer : typedAnswer;
    if (answer.trim() && onSubmitAnswer && !isLoading && question) {
      onSubmitAnswer(answer.trim());
    }
  };

  const badge = question
    ? `${formatConceptOrChunkTitle(question.conceptId)} · ${question.kind === "multiple_choice" ? "Multiple choice" : "Short answer"}`
    : undefined;

  return (
    <Panel
      title="Question"
      badge={badge}
      icon={<HelpCircle className="size-4 text-amber-400" />}
    >
      {isLoading && !question ? (
        <div className="py-8 text-center text-xs sm:text-sm text-amber-300/80">
          <div className="inline-block size-6 animate-spin rounded-full border-2 border-amber-400 border-t-transparent mb-2" />
          <p className="animate-pulse">Loading question grounded in notes…</p>
        </div>
      ) : !question ? (
        <EmptyState title="No question yet">
          Each question will be generated from your notes and shown here with its answer choices.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <p className="text-xs sm:text-sm font-medium leading-relaxed text-stone-100">
            {question.prompt}
          </p>

          {!evaluation && (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {question.kind === "multiple_choice" && question.choices && (
                <div className="space-y-2">
                  {question.choices.map((choice, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const isSelected = selectedAnswer === letter;
                    return (
                      <button
                        key={choice}
                        type="button"
                        onClick={() => setSelectedAnswer(letter)}
                        className={`w-full text-left rounded-xl border p-3 text-xs transition-all flex items-start gap-3 ${
                          isSelected
                            ? "border-amber-400/80 bg-amber-500/15 font-medium text-amber-100 shadow-md shadow-amber-950/40"
                            : "border-stone-800 bg-stone-900/60 hover:bg-stone-800/80 text-stone-300 hover:text-stone-100"
                        }`}
                      >
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded text-xs transition-colors shrink-0 ${
                            isSelected
                              ? "bg-amber-400 text-stone-950 font-extrabold shadow-sm"
                              : "bg-stone-800 text-stone-300"
                          }`}
                        >
                          {letter}
                        </span>
                        <span className="flex-1 mt-0.5 break-words">
                          {choice.replace(/^[A-Da-d][.):-]\s+/, "")}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {question.kind === "short_answer" && (
                <div>
                  <label htmlFor="quiz-answer" className="sr-only">
                    Your answer
                  </label>
                  <input
                    id="quiz-answer"
                    type="text"
                    value={typedAnswer}
                    onChange={(e) => setTypedAnswer(e.target.value)}
                    placeholder="Type your concise answer here..."
                    disabled={isLoading}
                    className="w-full rounded-lg border border-stone-800 bg-stone-950/90 px-3.5 py-2 text-xs text-stone-100 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-stone-400 truncate min-w-0">
                  {question.evidence?.chunkId ? (
                    <>
                      Grounded in note chunk{" "}
                      <code className="text-amber-400 font-mono">[{question.evidence.chunkId}]</code>
                    </>
                  ) : (
                    "Grounded in verified study notes"
                  )}
                </span>
                <button
                  type="submit"
                  disabled={
                    isLoading ||
                    (question.kind === "multiple_choice" ? !selectedAnswer : !typedAnswer.trim())
                  }
                  className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-xs font-semibold text-stone-950 shadow-md shadow-amber-950/40 hover:opacity-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  {isLoading ? "Grading..." : "Submit answer"}
                </button>
              </div>
            </form>
          )}

          <div className="flex flex-wrap gap-1.5 border-t border-stone-800/60 pt-2" aria-label="Question controls">
            {onSkipQuestion && <button type="button" disabled={isLoading} onClick={onSkipQuestion} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[10px] text-stone-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-40"><SkipForward className="size-3" />Skip</button>}
            {onRepeatQuestion && <button type="button" disabled={isLoading} onClick={onRepeatQuestion} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[10px] text-stone-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-40"><Repeat2 className="size-3" />Repeat</button>}
            {onExplainConcept && <button type="button" disabled={isLoading} onClick={onExplainConcept} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[10px] text-stone-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-40"><BookOpen className="size-3" />Explain</button>}
            {onGiveHint && <button type="button" disabled={isLoading} onClick={onGiveHint} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[10px] text-stone-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-40"><Lightbulb className="size-3" />Hint</button>}
            {onRequestMultipleChoice && <button type="button" disabled={isLoading} onClick={onRequestMultipleChoice} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[10px] text-stone-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-40"><ListChecks className="size-3" />MCQ</button>}
            {onRequestShortAnswer && <button type="button" disabled={isLoading} onClick={onRequestShortAnswer} className="inline-flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[10px] text-stone-300 hover:border-amber-500/60 hover:text-amber-200 disabled:opacity-40"><MessageSquareText className="size-3" />Short answer</button>}
          </div>

          {evaluation && (
            <div className="space-y-3 pt-1">
              <div
                className={`rounded-xl border p-3.5 sm:p-4 text-xs transition-all ${
                  evaluation.verdict === "correct"
                    ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300"
                    : evaluation.verdict === "partially_correct"
                      ? "border-amber-500/40 bg-amber-950/30 text-amber-300"
                      : "border-rose-500/40 bg-rose-950/30 text-rose-300"
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-sm">
                  {evaluation.verdict === "correct" ? (
                    <>
                      <CheckCircle2 className="size-4 text-emerald-400" />
                      <span>✔ Correct</span>
                    </>
                  ) : evaluation.verdict === "partially_correct" ? (
                    <>
                      <AlertCircle className="size-4 text-amber-400" />
                      <span>▲ Partially Correct</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="size-4 text-rose-400" />
                      <span>✖ Incorrect</span>
                    </>
                  )}
                </div>

                <p className="mt-1.5 text-xs text-stone-200 leading-relaxed">
                  {evaluation.explanation}
                </p>

                {evaluation.misconceptionLabel && (
                  <div className="mt-2.5 inline-flex items-center gap-1.5 rounded bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 text-[11px] font-mono font-medium text-rose-300">
                    <span>Diagnosed Misconception:</span>
                    <span>{evaluation.misconceptionLabel}</span>
                  </div>
                )}
              </div>

              {onNextQuestion && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-800/60 mt-2">
                  <div className="text-[11px] text-stone-400">
                    {autoAdvanceCountdown ? (
                      <div className="flex items-center gap-2">
                        <span className="text-amber-300 font-medium animate-pulse">
                          ⏱ Advancing automatically in {autoAdvanceCountdown}s ({progressionMode} mode)…
                        </span>
                        {onCancelAutoAdvance && (
                          <button
                            type="button"
                            onClick={onCancelAutoAdvance}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-stone-900 border border-stone-700 text-stone-300 hover:text-rose-300 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    ) : (
                      <span>
                        Ready for next question ({progressionMode} mode). Say{" "}
                        <strong className="text-stone-200">&ldquo;Next question&rdquo;</strong> or click:
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAnswer("");
                      setTypedAnswer("");
                      onNextQuestion();
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3.5 py-1.5 text-xs font-semibold text-amber-200 hover:text-white hover:border-amber-400 hover:bg-amber-500/20 transition-colors shadow-sm"
                  >
                    <span>Next Question</span>
                    <ArrowRight className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
