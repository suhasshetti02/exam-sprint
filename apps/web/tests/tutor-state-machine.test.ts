import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  TutorConversationStateMachine,
  canTransition,
  type TutorState,
} from "../lib/tutor-state-machine";

describe("Tutor Conversation State Machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes in idle state and guided progression mode by default", () => {
    const sm = new TutorConversationStateMachine();
    expect(sm.state).toBe("idle");
    expect(sm.progressionMode).toBe("guided");
    expect(sm.countdownRemaining).toBeNull();
  });

  it("validates legal and illegal transitions", () => {
    expect(canTransition("idle", "awaiting_answer")).toBe(true);
    expect(canTransition("awaiting_answer", "evaluating")).toBe(true);
    expect(canTransition("evaluating", "showing_feedback")).toBe(true);
    expect(canTransition("showing_feedback", "awaiting_next_action")).toBe(true);
    expect(canTransition("awaiting_next_action", "awaiting_answer")).toBe(true);

    // Illegal transitions without intermediate processing
    expect(canTransition("idle", "evaluating")).toBe(false);
  });

  it("executes legal transition sequence for complete answer evaluation flow", () => {
    const states: TutorState[] = [];
    const sm = new TutorConversationStateMachine({
      onStateChange: (s) => states.push(s),
    });

    expect(sm.transition("awaiting_answer")).toBe(true);
    expect(sm.transition("recognizing")).toBe(true);
    expect(sm.transition("processing")).toBe(true);
    expect(sm.transition("evaluating")).toBe(true);
    expect(sm.transition("showing_feedback")).toBe(true);
    expect(sm.transition("speaking")).toBe(true);
    expect(sm.transition("awaiting_next_action")).toBe(true);

    expect(states).toEqual([
      "awaiting_answer",
      "recognizing",
      "processing",
      "evaluating",
      "showing_feedback",
      "speaking",
      "awaiting_next_action",
    ]);
  });

  it("handles auto-advance countdown in automatic mode", () => {
    const ticks: Array<number | null> = [];
    const onTrigger = vi.fn();

    const sm = new TutorConversationStateMachine({
      initialState: "awaiting_next_action",
      initialMode: "automatic",
      onCountdownTick: (rem) => ticks.push(rem),
      onAutoAdvanceTrigger: onTrigger,
    });

    sm.startAutoAdvance(3000); // 3 seconds
    expect(sm.countdownRemaining).toBe(3);

    vi.advanceTimersByTime(1000);
    expect(sm.countdownRemaining).toBe(2);

    vi.advanceTimersByTime(1000);
    expect(sm.countdownRemaining).toBe(1);

    vi.advanceTimersByTime(1000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(sm.countdownRemaining).toBeNull();
  });

  it("cancelling auto-advance stops timer and countdown", () => {
    const onTrigger = vi.fn();
    const sm = new TutorConversationStateMachine({
      initialState: "awaiting_next_action",
      initialMode: "automatic",
      onAutoAdvanceTrigger: onTrigger,
    });

    sm.startAutoAdvance(5000);
    expect(sm.countdownRemaining).toBe(5);

    vi.advanceTimersByTime(2000);
    expect(sm.countdownRemaining).toBe(3);

    sm.cancelAutoAdvance();
    expect(sm.countdownRemaining).toBeNull();

    vi.advanceTimersByTime(5000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("stopping state machine halts auto-advance and transitions to stopped", () => {
    const sm = new TutorConversationStateMachine({
      initialState: "awaiting_next_action",
      initialMode: "automatic",
    });

    sm.startAutoAdvance(5000);
    sm.stop();

    expect(sm.state).toBe("stopped");
    expect(sm.countdownRemaining).toBeNull();
  });
});
