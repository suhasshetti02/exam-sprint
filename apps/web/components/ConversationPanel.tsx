"use client";

import { useEffect, useRef, useState } from "react";
import {
  Send,
  Zap,
  RotateCcw,
  Mic,
  Square,
  Volume2,
  VolumeX,
  Play,
  AlertCircle,
  RefreshCw,
  Radio,
} from "lucide-react";
import { AiOrb } from "./AiOrb";
import { EmptyState } from "./EmptyState";
import { useVoice, type UseVoiceReturn } from "../lib/use-voice";

import type { DocumentTopicSuggestion } from "../lib/api-client";

export interface MessageItem {
  id: string;
  role: "user" | "tutor" | "system";
  text: string;
  timestamp?: string;
}

interface ConversationPanelProps {
  messages?: MessageItem[];
  onSendMessage?: (text: string) => void;
  onStartTopic?: (topic: string) => void;
  onReviewWeak?: () => void;
  onStartChallenge?: () => void;
  isLoading?: boolean;
  hasWeakConcepts?: boolean;
  providerType?: "llm" | "deterministic_fallback";
  modelName?: string;
  activeMaterialTitle?: string;
  suggestedTopics?: DocumentTopicSuggestion[];
  voiceController?: UseVoiceReturn;
  progressionMode?: "guided" | "automatic";
  onToggleProgressionMode?: () => void;
  autoAdvanceCountdown?: number | null;
  onCancelAutoAdvance?: () => void;
}

const DEFAULT_FALLBACK_SHORTCUTS: DocumentTopicSuggestion[] = [
  { id: "normalization", label: "Quiz on Normalization", topic: "normalization" },
  { id: "2nf", label: "Practice 2NF", topic: "2NF" },
  { id: "acid", label: "Review ACID", topic: "ACID properties" },
];

export function ConversationPanel({
  messages = [],
  onSendMessage,
  onStartTopic,
  onReviewWeak,
  onStartChallenge,
  isLoading,
  hasWeakConcepts,
  providerType = "llm",
  modelName = "Gemini",
  activeMaterialTitle,
  suggestedTopics,
  voiceController,
  progressionMode = "guided",
  onToggleProgressionMode,
  autoAdvanceCountdown,
  onCancelAutoAdvance,
}: ConversationPanelProps) {
  // Only display document-derived suggested topics; if no material title is set and suggestedTopics is undefined (e.g. isolated component tests), use fallback shortcuts
  const activeTopics =
    suggestedTopics && suggestedTopics.length > 0
      ? suggestedTopics
      : suggestedTopics === undefined && !activeMaterialTitle
        ? DEFAULT_FALLBACK_SHORTCUTS
        : [];
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSpokenMessageIdRef = useRef<string | null>(null);

  // Initialize browser Web Speech API controller internally if not provided by parent
  const internalVoice = useVoice({
    onTranscript: (transcript) => {
      setInputText(transcript);
    },
  });

  const voice = voiceController || internalVoice;

  const {
    voiceState,
    isSupported,
    setWakeWordEnabled,
    voiceOutputEnabled,
    setVoiceOutputEnabled,
    currentTranscript,
    errorMessage: voiceError,
    startListening,
    stopListening,
    cancelListening,
    speak,
    stopSpeaking,
    replay,
  } = voice;

  // Automatically scroll conversation to bottom when messages update
  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === "function") {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Read tutor responses aloud if voice output is enabled
  useEffect(() => {
    if (!voiceOutputEnabled || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "tutor" && lastMsg.id !== lastSpokenMessageIdRef.current) {
      lastSpokenMessageIdRef.current = lastMsg.id;
      speak(lastMsg.text);
    }
  }, [messages, voiceOutputEnabled, speak]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (voiceState === "listening_for_command" || voiceState === "wake_listening") {
      stopListening();
    }
    const query = inputText.trim() || currentTranscript.trim();
    if (query && onSendMessage && !isLoading) {
      onSendMessage(query);
      setInputText("");
    }
  };

  return (
    <section
      className="warm-glass-panel rounded-2xl p-4 sm:p-5 flex flex-col h-full shadow-xl"
      aria-label="Conversation"
    >
      {/* Top Section: AI Orb & Identity */}
      <div className="pb-3 border-b border-stone-800/80">
        <AiOrb
          isLoading={isLoading}
          statusText={isLoading ? "Analyzing study notes & synthesizing response…" : undefined}
          providerType={providerType}
          modelName={modelName}
        />

        {/* Real Browser Voice & Audio Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-stone-800/60 text-xs">
          <div className="flex items-center gap-2">
            {!isSupported || voiceState === "unsupported" ? (
              // Preserved accessible disabled microphone for test suite and unsupported browsers
              <button
                type="button"
                disabled
                aria-label="Microphone (not connected)"
                className="px-2 py-0.5 rounded text-[11px] font-mono bg-stone-900/80 text-stone-400 border border-stone-800 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <span className="size-1.5 rounded-full bg-stone-500" />
                <span className="text-xs font-semibold">Voice off</span>
              </button>
            ) : voiceState === "disabled" ? (
              // Disabled state: push-to-talk button + Wake Word toggle
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={startListening}
                  disabled={isLoading}
                  aria-label="Microphone"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 border border-stone-700/80 px-2.5 py-1 text-xs font-medium text-stone-300 hover:border-amber-500/50 hover:text-amber-300 transition-all shadow-sm"
                >
                  <Mic className="size-3.5 text-stone-400" />
                  <span>Click to talk</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWakeWordEnabled(true)}
                  title="Turn on hands-free wake phrase ('Hey Exam Sprint')"
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-800 bg-stone-900/60 px-2 py-1 text-[11px] text-stone-400 hover:text-amber-300 hover:border-amber-500/40 transition-colors"
                >
                  <Radio className="size-3 text-stone-400" />
                  <span>&ldquo;Hey Exam Sprint&rdquo;</span>
                </button>
              </div>
            ) : voiceState === "requesting_permission" ? (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                <RefreshCw className="size-3 animate-spin text-amber-400" />
                <span>Requesting mic…</span>
              </div>
            ) : voiceState === "wake_listening" ? (
              // Wake word active listening
              <div className="flex items-center gap-1.5">
                <div
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-300 shadow-sm"
                  title="Listening for wake phrase: 'Hey Exam Sprint'"
                >
                  <span className="size-2 rounded-full bg-amber-400 animate-ping" />
                  <span>Waiting for &ldquo;Hey Exam Sprint&rdquo;…</span>
                </div>
                <button
                  type="button"
                  onClick={() => setWakeWordEnabled(false)}
                  title="Stop voice mode"
                  className="p-1 rounded-md bg-stone-900 border border-stone-800 text-stone-400 hover:text-rose-400"
                >
                  <Square className="size-3" />
                </button>
              </div>
            ) : voiceState === "listening_for_command" ? (
              // Listening for command: active recording with stop and cancel
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={stopListening}
                  aria-label="Microphone listening"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-300 animate-pulse shadow-sm"
                >
                  <span className="size-2 rounded-full bg-rose-400 animate-ping" />
                  <span>Listening… (say command)</span>
                </button>
                <button
                  type="button"
                  onClick={cancelListening}
                  title="Cancel voice input"
                  className="p-1 rounded-md bg-stone-900 border border-stone-800 text-stone-400 hover:text-rose-400"
                >
                  <Square className="size-3" />
                </button>
              </div>
            ) : voiceState === "processing" ? (
              // Processing state
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                <RefreshCw className="size-3 animate-spin text-amber-400" />
                <span>Evaluating command…</span>
              </div>
            ) : voiceState === "speaking" ? (
              // Speaking state: tutor reading response with mute option
              <button
                type="button"
                onClick={stopSpeaking}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-300 shadow-sm"
              >
                <Volume2 className="size-3.5 text-amber-400 animate-pulse" />
                <span>Speaking… (click to mute)</span>
              </button>
            ) : (
              // Error state with retry
              <button
                type="button"
                onClick={startListening}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-950/40 border border-rose-500/40 px-2 py-0.5 text-xs text-rose-300 hover:bg-rose-950/60"
              >
                <AlertCircle className="size-3.5 text-rose-400" />
                <span>Voice error (retry)</span>
              </button>
            )}

            {/* Voice Output Toggle */}
            <button
              type="button"
              onClick={() => {
                if (voiceState === "speaking") stopSpeaking();
                setVoiceOutputEnabled(!voiceOutputEnabled);
              }}
              title={voiceOutputEnabled ? "Mute tutor voice output" : "Enable tutor voice output"}
              className={`p-1 rounded-md border transition-all text-xs flex items-center gap-1 ${
                voiceOutputEnabled
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                  : "bg-stone-900/60 border-stone-800 text-stone-500 hover:text-stone-300"
              }`}
            >
              {voiceOutputEnabled ? (
                <Volume2 className="size-3.5 text-amber-400" />
              ) : (
                <VolumeX className="size-3.5" />
              )}
              <span className="text-[10px] hidden sm:inline">
                {voiceOutputEnabled ? "Voice Output ON" : "Voice Output OFF"}
              </span>
            </button>
            {/* Progression Mode Toggle: Guided vs Automatic */}
            {onToggleProgressionMode && (
              <button
                type="button"
                onClick={onToggleProgressionMode}
                title={
                  progressionMode === "automatic"
                    ? "Automatic mode: Advances to next question after explanation. Click for Guided."
                    : "Guided mode: Waits for you to say 'Next question'. Click for Automatic."
                }
                className={`p-1 rounded-md border transition-all text-xs flex items-center gap-1 ${
                  progressionMode === "automatic"
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-300 font-medium"
                    : "bg-stone-900/60 border-stone-800 text-stone-400 hover:text-stone-200"
                }`}
              >
                {progressionMode === "automatic" ? (
                  <Play className="size-3 text-amber-400" />
                ) : (
                  <Square className="size-3 text-stone-500" />
                )}
                <span className="text-[10px] hidden sm:inline">
                  {progressionMode === "automatic" ? "Auto-advance ON" : "Guided Mode"}
                </span>
              </button>
            )}
          </div>

          {/* Rapid-Fire Sprint Launcher Badge */}
          {onStartChallenge && (
            <button
              type="button"
              disabled={isLoading}
              onClick={onStartChallenge}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-xs font-semibold text-amber-400 hover:bg-amber-500/25 transition-all shadow-sm disabled:opacity-50"
            >
              <Zap className="size-3.5 fill-amber-400 text-amber-400" />
              <span>Start Sprint</span>
            </button>
          )}
        </div>

        {/* Live Transcript / Voice Guidance Banner */}
        {currentTranscript && (voiceState === "listening_for_command" || voiceState === "processing") && (
          <div className="mt-2 text-[11px] text-amber-200 bg-amber-500/15 border border-amber-500/30 rounded-lg px-2.5 py-1.5 flex items-center justify-between animate-fadeIn">
            <span className="truncate">🗣 Spoken: &ldquo;{currentTranscript}&rdquo;</span>
            <span className="text-[10px] text-amber-400/80 font-mono">Recognizing</span>
          </div>
        )}

        {/* Auto-Advance Countdown Notice */}
        {autoAdvanceCountdown !== null && autoAdvanceCountdown !== undefined && autoAdvanceCountdown > 0 && (
          <div className="mt-2 text-xs text-amber-300 bg-amber-500/20 border border-amber-500/40 rounded-lg px-3 py-1.5 flex items-center justify-between animate-pulse">
            <span className="font-semibold flex items-center gap-1.5">
              <span>⏱ Advancing to next question in {autoAdvanceCountdown}s…</span>
            </span>
            {onCancelAutoAdvance && (
              <button
                type="button"
                onClick={onCancelAutoAdvance}
                className="px-2 py-0.5 rounded text-[11px] font-bold bg-stone-900 border border-stone-700 text-stone-300 hover:text-rose-300 hover:border-rose-500 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Voice Error Notification */}
        {voiceError && voiceState === "error" && (
          <div className="mt-1.5 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-md px-2 py-1 flex items-center justify-between">
            <span>{voiceError}</span>
          </div>
        )}

        {/* Active Material Indicator */}
        {activeMaterialTitle && (
          <div className="mt-2 text-[11px] text-stone-400 flex items-center gap-1.5">
            <span className="text-stone-500">Studying:</span>
            <span className="font-semibold text-stone-200 truncate">
              {activeMaterialTitle}
            </span>
          </div>
        )}

        {/* Dynamic Topic Quick Shortcuts */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          <span className="text-[10px] uppercase font-bold tracking-wider text-stone-500 mr-0.5">
            Topics:
          </span>
          {activeTopics && activeTopics.length > 0 ? (
            activeTopics.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={isLoading}
                onClick={() => onStartTopic && onStartTopic(item.topic)}
                className="rounded-md border border-stone-800 bg-stone-900/80 px-2 py-0.5 text-[11px] text-stone-300 hover:border-amber-500/40 hover:text-amber-200 hover:bg-amber-950/30 transition-all disabled:opacity-50"
              >
                {item.label}
              </button>
            ))
          ) : (
            <button
              type="button"
              disabled={isLoading}
              onClick={() => onStartTopic && onStartTopic("full_document")}
              className="rounded-md border border-stone-800 bg-stone-900/80 px-2 py-0.5 text-[11px] text-stone-300 hover:border-amber-500/40 hover:text-amber-200 hover:bg-amber-950/30 transition-all disabled:opacity-50"
            >
              Study full document
            </button>
          )}
          {hasWeakConcepts && onReviewWeak && (
            <button
              type="button"
              disabled={isLoading}
              onClick={onReviewWeak}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="size-3" />
              <span>🎯 Retest Weak Concepts</span>
            </button>
          )}
        </div>
      </div>

      {/* Contained Conversation Transcript */}
      <div
        className="flex-1 min-h-0 overflow-y-auto py-3.5 space-y-3 pr-1"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <EmptyState title="No conversation yet">
            Tutor replies will appear here once you select a topic or ask a question.
          </EmptyState>
        ) : (
          messages.map((m) => {
            const isTutor = m.role === "tutor";
            const isSystem = m.role === "system";

            if (isSystem) {
              return (
                <div
                  key={m.id}
                  className="text-center text-[11px] text-rose-300/80 bg-rose-500/10 border border-rose-500/20 rounded-lg py-1 px-2 my-1"
                >
                  {m.text}
                </div>
              );
            }

            return (
              <div
                key={m.id}
                className={`flex gap-2.5 ${isTutor ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${
                    isTutor
                      ? "bg-stone-900/90 border border-stone-800/90 text-stone-200 rounded-tl-none"
                      : "bg-gradient-to-br from-amber-600/90 to-orange-700/90 text-stone-50 border border-amber-400/30 shadow-md font-medium rounded-tr-none"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1 opacity-80">
                    <p className="font-semibold text-[10px] uppercase tracking-wider">
                      {isTutor ? "🎓 StudyFlow AI Tutor" : "👤 You"}
                    </p>
                    {isTutor && (
                      <button
                        type="button"
                        onClick={() => replay(m.text)}
                        title="Replay spoken response"
                        className="p-0.5 rounded hover:text-amber-300 text-stone-400 transition-colors"
                      >
                        <Play className="size-3" />
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              </div>
            );
          })
        )}
        {isLoading && (
          <div className="flex gap-2.5 justify-start">
            <div className="rounded-xl bg-stone-900/80 border border-amber-500/30 px-3.5 py-2.5 text-xs text-amber-300 italic flex items-center gap-2 rounded-tl-none animate-pulse">
              <span className="size-2 rounded-full bg-amber-400 animate-ping" />
              <span>Tutor is thinking and retrieving notes…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Bar */}
      <form onSubmit={handleSubmit} className="pt-3 border-t border-stone-800/80 flex gap-2 shrink-0">
        <label htmlFor="utterance" className="sr-only">
          Message the tutor
        </label>
        <input
          id="utterance"
          type="text"
          value={voiceState === "listening_for_command" && currentTranscript ? currentTranscript : inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isLoading}
          placeholder={
            voiceState === "listening_for_command" || voiceState === "wake_listening"
              ? "Listening… speak now or type here…"
              : "Ask a question or topic (e.g. 'Quiz me on 2NF')..."
          }
          className="min-w-0 flex-1 rounded-lg border border-stone-800 bg-stone-950/90 px-3.5 py-2 text-xs text-stone-100 placeholder:text-stone-500 focus:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition-all disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={isLoading || !(inputText.trim() || currentTranscript.trim())}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-xs font-semibold text-stone-950 shadow-md shadow-amber-950/30 hover:opacity-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>{isLoading ? "Sending..." : "Send"}</span>
          <Send className="size-3" />
        </button>
      </form>
    </section>
  );
}
