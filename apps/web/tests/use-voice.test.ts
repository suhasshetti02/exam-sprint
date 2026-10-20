/** @vitest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useVoice, type IWindowSpeechRecognition } from "../lib/use-voice";

class MockSpeechRecognition implements IWindowSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "en-US";
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn(() => {
    setTimeout(() => {
      this.onstart?.();
    }, 0);
  });

  stop = vi.fn(() => {
    setTimeout(() => {
      this.onend?.();
    }, 0);
  });

  abort = vi.fn(() => {
    setTimeout(() => {
      this.onend?.();
    }, 0);
  });
}

class MockSpeechSynthesisUtterance {
  text = "";
  lang = "en-US";
  rate = 1;
  pitch = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

describe("useVoice hook", () => {
  let mockRecognitionInstances: MockSpeechRecognition[] = [];

  beforeEach(() => {
    mockRecognitionInstances = [];

    const MockRecognitionConstructor = vi.fn(function () {
      const inst = new MockSpeechRecognition();
      mockRecognitionInstances.push(inst);
      return inst;
    });

    vi.stubGlobal("SpeechRecognition", MockRecognitionConstructor);
    vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      speak: vi.fn((utt: MockSpeechSynthesisUtterance) => {
        utt.onstart?.();
      }),
      cancel: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("initializes in disabled state when recognition is supported", () => {
    const { result } = renderHook(() => useVoice());
    expect(result.current.isSupported).toBe(true);
    expect(result.current.voiceState).toBe("disabled");
    expect(result.current.wakeWordEnabled).toBe(false);
  });

  it("handles push-to-talk startListening transition to listening_for_command", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoice({ onTranscript }));

    act(() => {
      result.current.startListening();
    });

    expect(result.current.voiceState).toBe("requesting_permission");

    // Wait for onstart callback to trigger
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.voiceState).toBe("listening_for_command");
    expect(mockRecognitionInstances.length).toBe(1);
  });

  it("dispatches recognized command on final transcript", async () => {
    const onCommand = vi.fn();
    const { result } = renderHook(() =>
      useVoice({
        onCommand,
        context: {
          activeQuestion: {
            questionId: "q-1",
            conceptId: "2nf",
            kind: "multiple_choice",
            prompt: "Test prompt",
            choices: ["A choice", "B choice"],
            evidence: { chunkId: "c1", quote: "quote", status: "verified" },
          },
        },
      }),
    );

    act(() => {
      result.current.startListening();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const rec = mockRecognitionInstances[0]!;
    act(() => {
      const item: Array<{ transcript: string }> & { isFinal?: boolean } = [{ transcript: "select option A" }];
      item.isFinal = true;
      rec.onresult?.({
        resultIndex: 0,
        results: [item],
      });
    });

    expect(result.current.voiceState).toBe("processing");
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ type: "select_option", optionLetter: "A" }),
      "select option A",
    );
  });

  it("enables wake word mode and transitions to wake_listening", async () => {
    const { result } = renderHook(() => useVoice());

    act(() => {
      result.current.setWakeWordEnabled(true);
    });

    expect(result.current.wakeWordEnabled).toBe(true);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.voiceState).toBe("wake_listening");
    const rec = mockRecognitionInstances[0]!;
    expect(rec.continuous).toBe(true);
  });

  it("handles wake phrase detection 'Hey Exam Sprint'", async () => {
    const onCommand = vi.fn();
    const { result } = renderHook(() =>
      useVoice({
        onCommand,
      }),
    );

    act(() => {
      result.current.setWakeWordEnabled(true);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const rec = mockRecognitionInstances[0]!;

    // Learner says wake phrase followed by command in one breath
    act(() => {
      rec.onresult?.({
        resultIndex: 0,
        results: [
          [{ transcript: "Hey Exam Sprint repeat the question" }],
          { isFinal: true },
        ],
      });
    });

    expect(result.current.voiceState).toBe("processing");
    expect(onCommand).toHaveBeenCalledWith(
      { type: "repeat_question" },
      "repeat the question",
    );
  });

  it("handles permission denial error gracefully", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useVoice({ onError }));

    act(() => {
      result.current.startListening();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const rec = mockRecognitionInstances[0]!;
    act(() => {
      rec.onerror?.({ error: "not-allowed" });
    });

    expect(result.current.voiceState).toBe("error");
    expect(result.current.errorMessage).toMatch(/Microphone access was denied/i);
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Microphone access was denied/i));
  });

  it("suspends speech recognition during text-to-speech output", async () => {
    const { result } = renderHook(() => useVoice());

    act(() => {
      result.current.setVoiceOutputEnabled(true);
      result.current.startListening();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const rec = mockRecognitionInstances[0]!;

    act(() => {
      result.current.speak("Welcome to Exam Sprint!");
    });

    expect(rec.abort).toHaveBeenCalled();
    expect(result.current.voiceState).toBe("speaking");
  });

  it("stopping voice mode completely resets state to disabled", async () => {
    const { result } = renderHook(() => useVoice());

    act(() => {
      result.current.setWakeWordEnabled(true);
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      result.current.stopListening();
    });

    expect(result.current.voiceState).toBe("disabled");
    expect(result.current.wakeWordEnabled).toBe(false);
  });
});
