/**
 * Tutor Conversation State Machine for StudyFlow / Exam Sprint.
 *
 * Implements an explicit, typed state machine governing:
 * - Voice and audio lifecycle: idle, listening, recognizing, processing, speaking, stopped
 * - Quiz & question lifecycle: awaiting_answer, evaluating, showing_feedback, awaiting_next_action
 * - Error handling and recovery
 * - Cancellation of pending timers, speech, and auto-progression
 */

export type TutorState =
  | "idle"
  | "listening"
  | "recognizing"
  | "processing"
  | "speaking"
  | "awaiting_answer"
  | "evaluating"
  | "showing_feedback"
  | "awaiting_next_action"
  | "error"
  | "stopped";

export type ProgressionMode = "guided" | "automatic";

export interface ProgressionConfig {
  mode: ProgressionMode;
  autoAdvanceDelayMs: number; // e.g. 5000ms
}

export const DEFAULT_PROGRESSION_CONFIG: ProgressionConfig = {
  mode: "guided",
  autoAdvanceDelayMs: 5000,
};

// Legal transitions between states to enforce predictable lifecycle
const LEGAL_TRANSITIONS: Record<TutorState, TutorState[]> = {
  idle: ["listening", "awaiting_answer", "processing", "stopped", "error"],
  listening: ["recognizing", "processing", "speaking", "awaiting_answer", "stopped", "error", "idle"],
  recognizing: ["processing", "listening", "speaking", "stopped", "error"],
  processing: ["speaking", "evaluating", "showing_feedback", "listening", "awaiting_answer", "error", "stopped"],
  speaking: ["listening", "awaiting_answer", "showing_feedback", "awaiting_next_action", "stopped", "error"],
  awaiting_answer: ["recognizing", "processing", "evaluating", "speaking", "listening", "stopped", "error"],
  evaluating: ["showing_feedback", "speaking", "awaiting_next_action", "error", "stopped"],
  showing_feedback: ["speaking", "awaiting_next_action", "awaiting_answer", "listening", "stopped", "error"],
  awaiting_next_action: ["listening", "recognizing", "processing", "awaiting_answer", "speaking", "stopped", "error"],
  error: ["idle", "listening", "awaiting_answer", "stopped"],
  stopped: ["idle", "listening", "awaiting_answer"],
};

export function canTransition(from: TutorState, to: TutorState): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface StateMachineContext {
  state: TutorState;
  progressionMode: ProgressionMode;
  autoAdvanceCountdownSec: number | null;
  errorMessage?: string;
  activeQuestionId?: string;
}

export class TutorConversationStateMachine {
  private _state: TutorState = "idle";
  private _progressionMode: ProgressionMode = "guided";
  private _autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private _countdownTimer: ReturnType<typeof setInterval> | null = null;
  private _countdownRemaining: number | null = null;
  private _onStateChange?: (state: TutorState) => void;
  private _onCountdownTick?: (secondsRemaining: number | null) => void;
  private _onAutoAdvanceTrigger?: () => void;

  constructor(options: {
    initialState?: TutorState;
    initialMode?: ProgressionMode;
    onStateChange?: (state: TutorState) => void;
    onCountdownTick?: (secondsRemaining: number | null) => void;
    onAutoAdvanceTrigger?: () => void;
  } = {}) {
    if (options.initialState) this._state = options.initialState;
    if (options.initialMode) this._progressionMode = options.initialMode;
    this._onStateChange = options.onStateChange;
    this._onCountdownTick = options.onCountdownTick;
    this._onAutoAdvanceTrigger = options.onAutoAdvanceTrigger;
  }

  public get state(): TutorState {
    return this._state;
  }

  public getState(): TutorState {
    return this._state;
  }

  public getEffectiveVoiceState(): string {
    if (this._state === "listening" || this._state === "recognizing") return "listening_for_command";
    if (this._state === "speaking") return "speaking";
    if (this._state === "error") return "error";
    if (this._state === "stopped") return "disabled";
    return "ready";
  }

  public isAutoAdvanceActive(): boolean {
    return this._countdownRemaining !== null || this._autoAdvanceTimer !== null;
  }

  public get progressionMode(): ProgressionMode {
    return this._progressionMode;
  }

  public get countdownRemaining(): number | null {
    return this._countdownRemaining;
  }

  public setProgressionMode(mode: ProgressionMode): void {
    this._progressionMode = mode;
    if (mode === "guided") {
      this.cancelAutoAdvance();
    }
  }

  public transition(nextState: TutorState): boolean {
    if (this._state === nextState) return true;

    if (!canTransition(this._state, nextState)) {
      // In production resilient recovery: transition anyway if returning to safe states
      if (nextState === "stopped" || nextState === "idle" || nextState === "error") {
        this._state = nextState;
        this._onStateChange?.(this._state);
        return true;
      }
      return false;
    }

    this._state = nextState;
    this._onStateChange?.(this._state);

    // Cancel auto-advance timers whenever transitioning away from showing_feedback or awaiting_next_action
    if (nextState !== "showing_feedback" && nextState !== "awaiting_next_action") {
      this.cancelAutoAdvance();
    }

    return true;
  }

  public startAutoAdvance(delayMs = 5000): void {
    if (this._progressionMode !== "automatic") return;

    this.cancelAutoAdvance();

    let remaining = Math.ceil(delayMs / 1000);
    this._countdownRemaining = remaining;
    this._onCountdownTick?.(remaining);

    this._countdownTimer = setInterval(() => {
      remaining -= 1;
      this._countdownRemaining = remaining > 0 ? remaining : null;
      this._onCountdownTick?.(this._countdownRemaining);
      if (remaining <= 0 && this._countdownTimer) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
      }
    }, 1000);

    this._autoAdvanceTimer = setTimeout(() => {
      this.cancelAutoAdvance();
      this._onAutoAdvanceTrigger?.();
    }, delayMs);
  }

  public cancelAutoAdvance(): void {
    if (this._autoAdvanceTimer) {
      clearTimeout(this._autoAdvanceTimer);
      this._autoAdvanceTimer = null;
    }
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
    this._countdownRemaining = null;
    this._onCountdownTick?.(null);
  }

  public stop(): void {
    this.cancelAutoAdvance();
    this.transition("stopped");
  }

  public reset(): void {
    this.cancelAutoAdvance();
    this._state = "idle";
    this._onStateChange?.(this._state);
  }
}
