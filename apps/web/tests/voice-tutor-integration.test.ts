/** @vitest-environment jsdom */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useVoice, type IWindowSpeechRecognition } from "../lib/use-voice";
import { parseVoiceCommand } from "../lib/voice-command-parser";
import type { QuestionData } from "../lib/api-client";

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

describe("Voice Tutor Integration Suite", () => {
  let mockRecognitionInstances: MockSpeechRecognition[] = [];
  let mockSpeechSynthesisUtterances: MockSpeechSynthesisUtterance[] = [];

  const sampleQuestion: QuestionData = {
    questionId: "q-2nf-voice",
    conceptId: "2nf",
    kind: "multiple_choice",
    prompt: "Which dependency type does Second Normal Form strictly eliminate?",
    choices: [
      "Partial functional dependencies",
      "Transitive functional dependencies",
      "Multivalued dependencies",
      "Join dependencies",
    ],
    evidence: {
      chunkId: "dbms#2nf",
      quote: "Second Normal Form eliminates partial functional dependencies.",
      status: "verified",
    },
  };

  beforeEach(() => {
    mockRecognitionInstances = [];
    mockSpeechSynthesisUtterances = [];

    const MockRecognitionConstructor = vi.fn(function () {
      const inst = new MockSpeechRecognition();
      mockRecognitionInstances.push(inst);
      return inst;
    });

    vi.stubGlobal("SpeechRecognition", MockRecognitionConstructor);
    vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance);
    vi.stubGlobal("speechSynthesis", {
      speak: vi.fn((utt: MockSpeechSynthesisUtterance) => {
        mockSpeechSynthesisUtterances.push(utt);
        utt.onstart?.();
      }),
      cancel: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("1. Default Activation & Privacy (Req 11)", () => {
    it("never activates the microphone by default on mount", () => {
      const { result } = renderHook(() => useVoice());
      expect(result.current.voiceState).toBe("disabled");
      expect(result.current.wakeWordEnabled).toBe(false);
      expect(mockRecognitionInstances.length).toBe(0);
    });

    it("reports unsupported state when browser speech recognition is missing", () => {
      vi.unstubAllGlobals();
      const { result } = renderHook(() => useVoice());
      expect(result.current.isSupported).toBe(false);
      expect(result.current.voiceState).toBe("unsupported");
    });
  });

  describe("2. Answer Selection Routing & Safety (Req 1, 2, 3, 4, 6)", () => {
    it("1. 'Select option A' invokes answer evaluation, not note search", async () => {
      const mockSubmitAnswer = vi.fn();
      const mockStartTopicSearch = vi.fn();

      const handleUserMessage = async (text: string) => {
        const cmd = parseVoiceCommand(text, {
          activeQuestion: sampleQuestion,
          isQuestionAnswered: false,
        });
        if (cmd.type === "select_option") {
          await mockSubmitAnswer(cmd.optionLetter);
        } else if (cmd.type === "unknown") {
          await mockStartTopicSearch(text);
        }
      };

      await handleUserMessage("Select option A");
      expect(mockSubmitAnswer).toHaveBeenCalledWith("A");
      expect(mockStartTopicSearch).not.toHaveBeenCalled();
    });

    it("2. All supported answer-selection phrasings map to the correct option", () => {
      const phrasings: Array<{ input: string; expectedOption: string }> = [
        { input: "Select option A", expectedOption: "A" },
        { input: "Choose A", expectedOption: "A" },
        { input: "Option B", expectedOption: "B" },
        { input: "My answer is C", expectedOption: "C" },
        { input: "Submit answer D", expectedOption: "D" },
        { input: "Lock in A", expectedOption: "A" },
        { input: "I choose option A", expectedOption: "A" },
        { input: "Option ay", expectedOption: "A" },
        { input: "Option bee", expectedOption: "B" },
        { input: "Choose option see", expectedOption: "C" },
        { input: "Lock in option dee", expectedOption: "D" },
        { input: "Hey Exam Sprint, select option A", expectedOption: "A" },
      ];

      for (const { input, expectedOption } of phrasings) {
        const parsed = parseVoiceCommand(input, { activeQuestion: sampleQuestion });
        expect(parsed.type).toBe("select_option");
        if (parsed.type === "select_option") {
          expect(parsed.optionLetter).toBe(expectedOption);
        }
      }
    });

    it("3. Selection fails safely if there is no active question", () => {
      const parsed = parseVoiceCommand("Select option A", { activeQuestion: undefined });
      expect(parsed.type).toBe("ambiguous");
      if (parsed.type === "ambiguous") {
        expect(parsed.reason).toMatch(/no active question/i);
      }
    });

    it("4. An invalid option letter is rejected without guessing", () => {
      const command = parseVoiceCommand("Select option Z", {
        activeQuestion: sampleQuestion,
      });
      expect(command.type).toBe("ambiguous");
      if (command.type === "ambiguous") {
        expect(command.reason).toMatch(/not available for this question/i);
      }
    });

    it("6. A previously evaluated question cannot be submitted twice", () => {
      const command = parseVoiceCommand("Select option A", {
        activeQuestion: sampleQuestion,
        isQuestionAnswered: true,
      });
      expect(command.type).toBe("ambiguous");
      if (command.type === "ambiguous") {
        expect(command.reason).toMatch(/already been evaluated/i);
      }
    });

    it("rejects conflicting options like 'Select A or B'", () => {
      const command = parseVoiceCommand("Select A or B", {
        activeQuestion: sampleQuestion,
      });
      expect(command.type).toBe("ambiguous");
      if (command.type === "ambiguous") {
        expect(command.reason).toMatch(/conflicting choices/i);
      }
    });

    it("ensures voice command parser NEVER assigns grades or marks correct", () => {
      const command = parseVoiceCommand("Select option A", {
        activeQuestion: sampleQuestion,
      });
      expect(command.type).toBe("select_option");
      expect((command as unknown as { isCorrect?: boolean }).isCorrect).toBeUndefined();
      expect((command as unknown as { score?: number }).score).toBeUndefined();
    });
  });

  describe("3. Deduplication & Hands-free Recognition Loop (Req 5, 7, 8, 9, 10, 12)", () => {
    it("5. Duplicate final speech events result in one evaluation only", async () => {
      const onCommand = vi.fn();
      const { result } = renderHook(() =>
        useVoice({
          onCommand,
          context: { activeQuestion: sampleQuestion },
        }),
      );

      act(() => {
        result.current.startListening();
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });

      const rec = mockRecognitionInstances[0]!;

      // Emit first final result
      act(() => {
        const item: Array<{ transcript: string }> & { isFinal?: boolean } = [
          { transcript: "Select option B" },
        ];
        item.isFinal = true;
        rec.onresult?.({
          resultIndex: 0,
          results: [item],
        });
      });

      expect(onCommand).toHaveBeenCalledTimes(1);
      expect(onCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: "select_option", optionLetter: "B" }),
        "Select option B",
      );

      // Emit duplicate identical final result (common browser quirk)
      act(() => {
        const item: Array<{ transcript: string }> & { isFinal?: boolean } = [
          { transcript: "Select option B" },
        ];
        item.isFinal = true;
        rec.onresult?.({
          resultIndex: 0,
          results: [item],
        });
      });

      // Assert that duplicate submission was rejected
      expect(onCommand).toHaveBeenCalledTimes(1);
    });

    it("7. Hands-free mode resumes listening after an ordinary recognition onend", async () => {
      const { result } = renderHook(() => useVoice());

      act(() => {
        result.current.setWakeWordEnabled(true);
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });

      expect(result.current.voiceState).toBe("wake_listening");
      const initialRec = mockRecognitionInstances[0]!;

      // Ordinary onend fired by browser after silence pause
      act(() => {
        initialRec.onend?.();
      });

      // Wait past the restart delay (300ms)
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350));
      });

      // Recognition must automatically restart and remain in wake_listening
      expect(mockRecognitionInstances.length).toBeGreaterThan(1);
      expect(result.current.voiceState).toBe("wake_listening");
    });

    it("8. Listening resumes after tutor speech finishes", async () => {
      const { result } = renderHook(() => useVoice());

      act(() => {
        result.current.setVoiceOutputEnabled(true);
        result.current.setWakeWordEnabled(true);
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });

      expect(result.current.voiceState).toBe("wake_listening");
      const initialRec = mockRecognitionInstances[0]!;

      // Tutor speaks grounded response
      act(() => {
        result.current.speak("Correct! Second Normal Form removes partial functional dependencies.");
      });

      // Recognition must be aborted while TTS is speaking to prevent feedback loop
      expect(initialRec.abort).toHaveBeenCalled();
      expect(result.current.voiceState).toBe("speaking");

      // Speech ends
      const activeUtterance = mockSpeechSynthesisUtterances[0]!;
      act(() => {
        activeUtterance.onend?.();
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });

      expect(result.current.voiceState).toBe("wake_listening");
    });

    it("9. Recognition remains stopped when the user presses Stop Voice", async () => {
      const { result } = renderHook(() => useVoice());

      act(() => {
        result.current.setVoiceOutputEnabled(true);
        result.current.setWakeWordEnabled(true);
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });

      act(() => {
        result.current.speak("Long tutor explanation...");
      });

      expect(result.current.voiceState).toBe("speaking");

      act(() => {
        result.current.stopListening();
      });

      expect(result.current.voiceState).toBe("disabled");
      expect(result.current.wakeWordEnabled).toBe(false);

      // Verify recognition does not restart after speech or timeout
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350));
      });

      expect(result.current.voiceState).toBe("disabled");
    });

    it("10. Permission denial does not trigger an infinite restart loop", async () => {
      const onError = vi.fn();
      const { result } = renderHook(() => useVoice({ onError }));

      act(() => {
        result.current.setWakeWordEnabled(true);
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });

      const rec = mockRecognitionInstances[0]!;
      act(() => {
        rec.onerror?.({ error: "not-allowed" });
      });

      expect(result.current.voiceState).toBe("error");
      expect(result.current.wakeWordEnabled).toBe(false);
      expect(result.current.errorMessage).toMatch(/Microphone access was denied/i);
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Microphone access was denied/i));

      const countAfterError = mockRecognitionInstances.length;

      // Wait to ensure no restart loop triggers
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });

      expect(mockRecognitionInstances.length).toBe(countAfterError);
    });

    it("12. Push-to-talk still works independently when hands-free mode is disabled", async () => {
      const onCommand = vi.fn();
      const { result } = renderHook(() =>
        useVoice({
          onCommand,
          context: { activeQuestion: sampleQuestion },
        }),
      );

      // Verify hands-free is disabled
      expect(result.current.wakeWordEnabled).toBe(false);

      // Push-to-talk start
      act(() => {
        result.current.startListening();
      });

      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });

      expect(result.current.voiceState).toBe("listening_for_command");
      const rec = mockRecognitionInstances[0]!;

      act(() => {
        const item: Array<{ transcript: string }> & { isFinal?: boolean } = [
          { transcript: "give me a hint" },
        ];
        item.isFinal = true;
        rec.onresult?.({
          resultIndex: 0,
          results: [item],
        });
      });

      expect(onCommand).toHaveBeenCalledWith(
        { type: "give_hint" },
        "give me a hint",
      );
    });
  });
});
