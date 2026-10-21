"use client";

/**
 * Web Speech API hook for conversational voice tutoring in StudyFlow / Exam Sprint.
 *
 * Implements:
 * - Typed 8-state machine:
 *     'unsupported' | 'disabled' | 'requesting_permission' |
 *     'wake_listening' | 'listening_for_command' | 'processing' | 'speaking' | 'error'
 * - Hands-free continuous listening mode ("Hey Exam Sprint" and direct study commands)
 * - Push-to-talk command recognition
 * - Speech synthesis for grounded tutor explanations
 * - Mutual suspension: halts speech recognition during TTS playback to prevent audio feedback
 * - Automatic resumption of wake listening after tutor finished speaking
 * - Strict duplicate submission and race-condition prevention
 * - Resilient restart on normal browser silence without arbitrary restart cutoff
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  extractWakePhraseAndCommand,
  parseVoiceCommand,
  type CommandParserContext,
  type VoiceCommand,
} from "./voice-command-parser";

export type VoiceState =
  | "unsupported"
  | "disabled"
  | "requesting_permission"
  | "wake_listening"
  | "listening_for_command"
  | "processing"
  | "speaking"
  | "error";

export interface UseVoiceOptions {
  onTranscript?: (transcript: string, isFinal: boolean) => void;
  onCommand?: (command: VoiceCommand, rawTranscript: string) => void;
  onError?: (errorMessage: string) => void;
  onSpeechEnd?: () => void;
  context?: CommandParserContext;
}

// Minimal Web Speech API typing for cross-browser safety
export interface IWindowSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
}

const emptySubscribe = () => () => {};

/**
 * Subtle non-blocking audio chime on wake-phrase detection using Web Audio API.
 */
function playWakeChime() {
  try {
    if (typeof window === "undefined") return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.22);
  } catch {
    // Non-fatal if audio context is unavailable or restricted
  }
}

export function useVoice(options: UseVoiceOptions = {}) {
  const isSupported = useSyncExternalStore(
    emptySubscribe,
    () =>
      typeof window !== "undefined" &&
      Boolean(
        (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition,
      ),
    () => false,
  );

  const isSynthSupported = useSyncExternalStore(
    emptySubscribe,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );

  const [voiceState, setVoiceState] = useState<VoiceState>(
    isSupported ? "disabled" : "unsupported",
  );
  const [wakeWordEnabled, setWakeWordEnabledState] = useState(false);
  const [voiceOutputEnabled, setVoiceOutputEnabled] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const recognitionRef = useRef<IWindowSpeechRecognition | null>(null);
  const wakeWordEnabledRef = useRef(wakeWordEnabled);
  const isManuallyStoppedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isProcessingRef = useRef(false);
  const isCommandListeningRef = useRef(false);
  const lastSpokenTextRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  const commandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubmittedKeyRef = useRef<string | null>(null);
  const lastSubmittedTimeRef = useRef<number>(0);
  const hasPermissionErrorRef = useRef(false);

  const activeUtterancesRef = useRef<Set<SpeechSynthesisUtterance>>(new Set());

  useEffect(() => {
    wakeWordEnabledRef.current = wakeWordEnabled;
  }, [wakeWordEnabled]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // Cleanup speech synthesis and speech recognition on unmount
  useEffect(() => {
    const activeUtterances = activeUtterancesRef.current;
    return () => {
      if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      activeUtterances.clear();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // Non-fatal
        }
      }
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      activeUtterancesRef.current.clear();
      isSpeakingRef.current = false;
      setVoiceState((prev) =>
        prev === "speaking" ? (wakeWordEnabledRef.current ? "wake_listening" : "disabled") : prev,
      );
    }
  }, []);

  const createRecognitionInstance = useCallback(() => {
    if (typeof window === "undefined") return null;
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => IWindowSpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => IWindowSpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRec) return null;
    return new SpeechRec();
  }, []);

  // Forward declaration for mutual recursion between speak & wake listening
  const startWakeListeningRef = useRef<() => void>(() => {});

  const speak = useCallback(
    (text: string) => {
      if (!isSynthSupported || !voiceOutputEnabled || !text.trim()) return;

      try {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          // Suspend speech recognition during text-to-speech to avoid audio feedback
          isSpeakingRef.current = true;
          if (recognitionRef.current) {
            try {
              recognitionRef.current.onend = null;
              recognitionRef.current.onerror = null;
              recognitionRef.current.abort();
            } catch {
              // Non-fatal
            }
          }

          if (window.speechSynthesis.paused) {
            try {
              window.speechSynthesis.resume();
            } catch {
              // Non-fatal
            }
          }
          window.speechSynthesis.cancel();
          activeUtterancesRef.current.clear();

          // Strip markdown symbols and internal link artifacts for natural speech output
          const cleanText = text
            .replace(/[*_#`~]/g, "")
            .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
            .replace(/chars \d+–\d+/g, "")
            .trim();

          if (!cleanText) return;

          const utterance = new SpeechSynthesisUtterance(cleanText);
          activeUtterancesRef.current.add(utterance);
          utterance.lang = "en-US";
          utterance.rate = 1.0;
          utterance.pitch = 1.0;

          utterance.onstart = () => {
            isSpeakingRef.current = true;
            setVoiceState("speaking");
          };

          const handleSpeechEnd = () => {
            activeUtterancesRef.current.delete(utterance);
            isSpeakingRef.current = false;
            isProcessingRef.current = false;
            if (wakeWordEnabledRef.current && !isManuallyStoppedRef.current) {
              setVoiceState("wake_listening");
              startWakeListeningRef.current();
            } else {
              setVoiceState("disabled");
            }
            optionsRef.current.onSpeechEnd?.();
          };

          utterance.onend = handleSpeechEnd;
          utterance.onerror = handleSpeechEnd;

          lastSpokenTextRef.current = cleanText;
          window.speechSynthesis.speak(utterance);
        }
      } catch {
        isSpeakingRef.current = false;
        isProcessingRef.current = false;
        setVoiceState(wakeWordEnabledRef.current ? "wake_listening" : "disabled");
      }
    },
    [isSynthSupported, voiceOutputEnabled],
  );

  const startWakeListening = useCallback(() => {
    if (!isSupported) {
      setVoiceState("unsupported");
      return;
    }

    if (hasPermissionErrorRef.current) {
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch {
        // Non-fatal
      }
    }

    const recognition = createRecognitionInstance();
    if (!recognition) return;

    recognitionRef.current = recognition;
    isManuallyStoppedRef.current = false;
    isSpeakingRef.current = false;
    isProcessingRef.current = false;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setVoiceState(isCommandListeningRef.current ? "listening_for_command" : "wake_listening");
      setErrorMessage(undefined);
    };

    recognition.onresult = (event: unknown) => {
      const speechEvent = event as {
        resultIndex: number;
        results: Array<Array<{ transcript: string }> & { isFinal?: boolean }>;
      };

      let fullTranscript = "";
      let isFinal = false;

      for (let i = speechEvent.resultIndex; i < speechEvent.results.length; i++) {
        const res = speechEvent.results[i];
        if (res && res[0]) {
          fullTranscript += res[0].transcript;
          if (res.isFinal) isFinal = true;
        }
      }

      const trimmed = fullTranscript.trim();
      if (!trimmed) return;

      const { hasWakePhrase, remainingCommand } = extractWakePhraseAndCommand(trimmed);

      let targetText = "";

      if (hasWakePhrase) {
        playWakeChime();

        if (remainingCommand.trim().length > 0) {
          // Combined wake phrase + command in one utterance e.g. "Hey Exam Sprint, select option A"
          targetText = remainingCommand.trim();
        } else {
          // Wake phrase alone: transition to command listening mode
          isCommandListeningRef.current = true;
          setVoiceState("listening_for_command");
          setCurrentTranscript("");

          if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
          commandTimeoutRef.current = setTimeout(() => {
            isCommandListeningRef.current = false;
            if (wakeWordEnabledRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
              setVoiceState("wake_listening");
            }
          }, 10000);
          return;
        }
      } else if (isCommandListeningRef.current) {
        // Spoken command after wake phrase
        targetText = remainingCommand.trim() || trimmed;
      } else if (wakeWordEnabledRef.current) {
        // Continuous hands-free mode: check if text matches an unambiguous command
        const candidateCmd = parseVoiceCommand(trimmed, optionsRef.current.context);
        if (candidateCmd.type !== "unknown") {
          targetText = trimmed;
        }
      }

      if (targetText) {
        setCurrentTranscript(targetText);
        optionsRef.current.onTranscript?.(targetText, isFinal);

        const command = parseVoiceCommand(targetText, optionsRef.current.context);

        // Immediate stop voice command
        if (command.type === "stop_voice") {
          isManuallyStoppedRef.current = true;
          setWakeWordEnabledState(false);
          wakeWordEnabledRef.current = false;
          if (recognitionRef.current) {
            try {
              recognitionRef.current.abort();
            } catch {
              // Non-fatal
            }
          }
          if (typeof window !== "undefined" && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
          }
          setVoiceState("disabled");
          setCurrentTranscript("");
          optionsRef.current.onCommand?.(command, targetText);
          return;
        }

        // Process command on final speech result or recognized unambiguous command
        if (isFinal || command.type === "select_option" || command.type === "repeat_question" || command.type === "give_hint") {
          const qId = optionsRef.current.context?.activeQuestion?.questionId ?? "no-q";
          const submissionKey = `${qId}_${command.type}_${targetText.toLowerCase()}`;

          if (
            lastSubmittedKeyRef.current === submissionKey &&
            Date.now() - lastSubmittedTimeRef.current < 2500
          ) {
            // Reject duplicate speech recognition final event
            return;
          }

          lastSubmittedKeyRef.current = submissionKey;
          lastSubmittedTimeRef.current = Date.now();

          isCommandListeningRef.current = false;
          setVoiceState("processing");
          isProcessingRef.current = true;

          optionsRef.current.onCommand?.(command, targetText);
        }
      }
    };

    recognition.onerror = (event: unknown) => {
      const errEvent = event as { error?: string };
      const code = errEvent.error || "unknown";

      if (code === "no-speech") {
        // Expected when idle in wake listening mode, don't show error
        return;
      }

      let friendlyError = "Speech recognition encountered an issue. Click to retry.";
      if (code === "not-allowed" || code === "permission-denied") {
        friendlyError = "Microphone access was denied. Please allow microphone permissions in browser settings.";
        hasPermissionErrorRef.current = true;
        setWakeWordEnabledState(false);
        wakeWordEnabledRef.current = false;
      } else if (code === "audio-capture") {
        friendlyError = "Microphone is unavailable or in use by another application.";
        hasPermissionErrorRef.current = true;
        setWakeWordEnabledState(false);
        wakeWordEnabledRef.current = false;
      } else if (code === "network") {
        friendlyError = "Network error during speech recognition. Please check your connection.";
      }

      setErrorMessage(friendlyError);
      setVoiceState("error");
      optionsRef.current.onError?.(friendlyError);
    };

    recognition.onend = () => {
      if (hasPermissionErrorRef.current) {
        return;
      }

      if (isManuallyStoppedRef.current) {
        setVoiceState("disabled");
        return;
      }

      // Do not restart while tutor is speaking (will restart in utterance.onend)
      if (isSpeakingRef.current) {
        return;
      }

      // Do not restart while command is processing (will resume after tutor responds)
      if (isProcessingRef.current) {
        return;
      }

      // If hands-free mode is enabled, restart recognition cleanly
      if (wakeWordEnabledRef.current) {
        setTimeout(() => {
          if (
            wakeWordEnabledRef.current &&
            !hasPermissionErrorRef.current &&
            !isManuallyStoppedRef.current &&
            !isSpeakingRef.current &&
            !isProcessingRef.current
          ) {
            startWakeListeningRef.current();
          }
        }, 150);
      } else {
        setVoiceState((prev) => (prev === "error" ? "error" : "disabled"));
      }
    };

    try {
      setVoiceState("requesting_permission");
      recognition.start();
    } catch {
      setVoiceState("error");
      setErrorMessage("Failed to start voice listener.");
    }
  }, [createRecognitionInstance, isSupported]);

  useEffect(() => {
    startWakeListeningRef.current = startWakeListening;
  }, [startWakeListening]);

  const startListening = useCallback(() => {
    if (!isSupported) {
      const msg = "Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.";
      setErrorMessage(msg);
      setVoiceState("unsupported");
      optionsRef.current.onError?.(msg);
      return;
    }

    stopSpeaking();
    hasPermissionErrorRef.current = false;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch {
        // Non-fatal
      }
    }

    const recognition = createRecognitionInstance();
    if (!recognition) return;

    recognitionRef.current = recognition;
    isManuallyStoppedRef.current = false;
    isSpeakingRef.current = false;
    isProcessingRef.current = false;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setVoiceState("listening_for_command");
      setErrorMessage(undefined);
      setCurrentTranscript("");
    };

    recognition.onresult = (event: unknown) => {
      const speechEvent = event as {
        resultIndex: number;
        results: Array<Array<{ transcript: string }> & { isFinal?: boolean }>;
      };

      let transcript = "";
      let isFinal = false;

      for (let i = speechEvent.resultIndex; i < speechEvent.results.length; i++) {
        const res = speechEvent.results[i];
        if (res && res[0]) {
          transcript += res[0].transcript;
          if (res.isFinal) isFinal = true;
        }
      }

      if (transcript) {
        setCurrentTranscript(transcript);
        optionsRef.current.onTranscript?.(transcript, isFinal);

        if (isFinal) {
          setVoiceState("processing");
          isProcessingRef.current = true;
          const { remainingCommand } = extractWakePhraseAndCommand(transcript);
          const commandText = remainingCommand.trim() || transcript.trim();
          const command = parseVoiceCommand(commandText, optionsRef.current.context);

          const qId = optionsRef.current.context?.activeQuestion?.questionId ?? "no-q";
          const submissionKey = `${qId}_${command.type}_${commandText.toLowerCase()}`;

          if (
            lastSubmittedKeyRef.current === submissionKey &&
            Date.now() - lastSubmittedTimeRef.current < 2500
          ) {
            return;
          }

          lastSubmittedKeyRef.current = submissionKey;
          lastSubmittedTimeRef.current = Date.now();

          optionsRef.current.onCommand?.(command, commandText);
        }
      }
    };

    recognition.onerror = (event: unknown) => {
      const errEvent = event as { error?: string };
      const code = errEvent.error || "unknown";

      let friendlyError = "Speech recognition encountered an issue. Click to retry.";
      if (code === "not-allowed" || code === "permission-denied") {
        friendlyError = "Microphone access was denied. Please allow microphone permissions in browser settings.";
        hasPermissionErrorRef.current = true;
      } else if (code === "no-speech") {
        friendlyError = "No speech was detected. Click microphone to speak again.";
      } else if (code === "audio-capture") {
        friendlyError = "Microphone is unavailable or in use by another application.";
        hasPermissionErrorRef.current = true;
      } else if (code === "network") {
        friendlyError = "Network error during speech recognition. Please check your connection.";
      }

      setErrorMessage(friendlyError);
      setVoiceState("error");
      optionsRef.current.onError?.(friendlyError);
    };

    recognition.onend = () => {
      if (!isManuallyStoppedRef.current) {
        if (
          wakeWordEnabledRef.current &&
          !hasPermissionErrorRef.current &&
          !isSpeakingRef.current &&
          !isProcessingRef.current
        ) {
          setVoiceState("wake_listening");
          startWakeListening();
        } else {
          setVoiceState((prev) => (prev === "error" ? "error" : "disabled"));
        }
      }
    };

    try {
      setVoiceState("requesting_permission");
      recognition.start();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to initiate voice recognition.";
      setErrorMessage(msg);
      setVoiceState("error");
      optionsRef.current.onError?.(msg);
    }
  }, [createRecognitionInstance, isSupported, startWakeListening, stopSpeaking]);

  const stopListening = useCallback(() => {
    isManuallyStoppedRef.current = true;
    wakeWordEnabledRef.current = false;
    isSpeakingRef.current = false;
    isProcessingRef.current = false;
    isCommandListeningRef.current = false;

    if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch {
        // Non-fatal
      }
    }
    setVoiceState("disabled");
    setCurrentTranscript("");
    setWakeWordEnabledState(false);
  }, []);

  const cancelListening = useCallback(() => {
    isManuallyStoppedRef.current = true;
    wakeWordEnabledRef.current = false;
    isSpeakingRef.current = false;
    isProcessingRef.current = false;
    isCommandListeningRef.current = false;

    if (commandTimeoutRef.current) clearTimeout(commandTimeoutRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort();
      } catch {
        // Non-fatal
      }
    }
    setVoiceState("disabled");
    setErrorMessage(undefined);
    setCurrentTranscript("");
    setWakeWordEnabledState(false);
  }, []);

  const setWakeWordEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        hasPermissionErrorRef.current = false;
      }
      setWakeWordEnabledState(enabled);
      wakeWordEnabledRef.current = enabled;
      if (enabled) {
        startWakeListening();
      } else {
        stopListening();
      }
    },
    [startWakeListening, stopListening],
  );

  const replay = useCallback(
    (textToReplay?: string) => {
      const text = textToReplay || lastSpokenTextRef.current;
      if (!text || !isSynthSupported) return;

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          text.replace(/[*_#`~]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim(),
        );
        utterance.lang = "en-US";
        utterance.onstart = () => {
          isSpeakingRef.current = true;
          setVoiceState("speaking");
        };
        const handleReplayEnd = () => {
          isSpeakingRef.current = false;
          if (wakeWordEnabledRef.current && !isManuallyStoppedRef.current) {
            setVoiceState("wake_listening");
            startWakeListeningRef.current();
          } else {
            setVoiceState("disabled");
          }
        };
        utterance.onend = handleReplayEnd;
        utterance.onerror = handleReplayEnd;
        window.speechSynthesis.speak(utterance);
      }
    },
    [isSynthSupported],
  );

  return {
    voiceState: !isSupported ? "unsupported" : voiceState,
    isSupported,
    isSynthSupported,
    wakeWordEnabled,
    setWakeWordEnabled,
    voiceOutputEnabled,
    setVoiceOutputEnabled,
    currentTranscript,
    errorMessage,
    startListening,
    stopListening,
    cancelListening,
    speak,
    stopSpeaking,
    replay,
  };
}

export type UseVoiceReturn = ReturnType<typeof useVoice>;
