"use client";

import { useEffect, useState, useRef } from "react";
import { Zap, Activity, ShieldCheck, ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { ConversationPanel, type MessageItem } from "./ConversationPanel";
import { EvidenceCard } from "./EvidenceCard";
import { MasteryPanel } from "./MasteryPanel";
import { QuizCard } from "./QuizCard";
import { RapidFireChallenge } from "./RapidFireChallenge";
import { ServerStatus } from "./ServerStatus";
import { StatusChecklist } from "./StatusChecklist";
import { SetupScreen, type LearningGoal, type SessionConfig } from "./SetupScreen";
import { isWeakConceptsRequest } from "@/lib/topic-utils";
import {
  fetchDocumentTopics,
  fetchInitialState,
  fetchServerStatus,
  startSession,
  submitAnswer,
  type DocumentTopicSuggestion,
  type EvaluationData,
  type EvidenceData,
  type ExecutionMetadata,
  type MasteryConcept,
  type QuestionData,
  type ServerStatus as Status,
  type ToolTraceEntry,
} from "@/lib/api-client";
import { useVoice } from "@/lib/use-voice";
import { parseVoiceCommand, type VoiceCommand } from "@/lib/voice-command-parser";
import type { ProgressionMode } from "@/lib/tutor-state-machine";

interface SavedSession {
  documentId: string;
  documentTitle: string;
  goal: LearningGoal;
  topic?: string;
  messages: MessageItem[];
  question?: QuestionData;
  evidence?: EvidenceData;
  savedAt: string;
}

const GOAL_LABELS: Record<LearningGoal, { label: string; icon: string }> = {
  teach: { label: "Teach Material", icon: "📖" },
  quiz: { label: "Quiz on Topic", icon: "❓" },
  weak: { label: "Revise Weak Concepts", icon: "🎯" },
  full_document: { label: "Full Document Study", icon: "📚" },
};

let messageCounter = 0;
function createMsgId(prefix: string): string {
  messageCounter += 1;
  return `${prefix}_${Date.now()}_${messageCounter}`;
}

function createAttemptId(questionId: string): string {
  return `attempt_${questionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createIsoTimestamp(): string {
  return new Date().toISOString();
}

export function TutoringSession() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [activeDocumentId, setActiveDocumentId] = useState<string>("dbms-normalization");
  const [activeDocumentTitle, setActiveDocumentTitle] = useState<string>("Sample DBMS Notes");
  const [activeGoal, setActiveGoal] = useState<LearningGoal>("teach");
  const [savedSession, setSavedSession] = useState<SavedSession | null>(null);

  // Restore saved session safely after client mount to eliminate SSR hydration mismatch
  useEffect(() => {
    try {
      const stored = localStorage.getItem("exam_sprint_active_session");
      if (stored) {
        const parsed = JSON.parse(stored) as SavedSession;
        if (parsed && parsed.documentId && parsed.messages) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSavedSession(parsed);
        }
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const [messages, setMessages] = useState<MessageItem[]>([
    {
      id: "welcome-1",
      role: "tutor",
      text: "Welcome to Exam Sprint! I'm your Alexa+ adaptive exam tutor. Select a topic below or type what you'd like to practice, and every question will be grounded in verified evidence from your study notes.",
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  ]);

  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | undefined>();
  const [currentEvidence, setCurrentEvidence] = useState<EvidenceData | undefined>();
  const [latestEvaluation, setLatestEvaluation] = useState<EvaluationData | undefined>();
  const [masteryList, setMasteryList] = useState<MasteryConcept[]>([]);
  const [toolTraces, setToolTraces] = useState<ToolTraceEntry[]>([]);
  const [serverStatus, setServerStatus] = useState<Status | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [isChallengeOpen, setIsChallengeOpen] = useState(false);
  const [showStatusChecklist, setShowStatusChecklist] = useState(false);
  const [suggestedTopics, setSuggestedTopics] = useState<DocumentTopicSuggestion[]>([]);
  const [currentProvider, setCurrentProvider] = useState<"llm" | "deterministic_fallback">("deterministic_fallback");
  const [executionMetadata, setExecutionMetadata] = useState<ExecutionMetadata | undefined>();
  const [selectedOption, setSelectedOption] = useState<string | undefined>();
  const [progressionMode, setProgressionMode] = useState<ProgressionMode>("guided");
  const [autoAdvanceCountdown, setAutoAdvanceCountdown] = useState<number | null>(null);
  const [currentSectionOrdinal, setCurrentSectionOrdinal] = useState(1);
  const [pendingVoiceSubmission, setPendingVoiceSubmission] = useState<{
    optionLetter: "A" | "B" | "C" | "D" | "E";
    rawTranscript: string;
  } | null>(null);


  // Monotonic request counter ref to eliminate race conditions on overlapping or rapid topic switches
  const latestRequestIdRef = useRef(0);

  // In-flight double-click protection and stable retry attempt ID tracking
  const inFlightSubmissionRef = useRef<{ questionId: string; answer: string; clientAttemptId: string } | null>(null);
  const lastAttemptRef = useRef<{ questionId: string; answer: string; clientAttemptId: string } | null>(null);

  // Auto-advance progression timer refs
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressionModeRef = useRef<ProgressionMode>(progressionMode);
  const latestEvaluationRef = useRef<EvaluationData | undefined>(latestEvaluation);

  useEffect(() => {
    progressionModeRef.current = progressionMode;
    latestEvaluationRef.current = latestEvaluation;
  }, [progressionMode, latestEvaluation]);

  const cancelAutoAdvance = () => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setAutoAdvanceCountdown(null);
  };

  const startAutoAdvance = (delayMs = 5000) => {
    if (progressionModeRef.current !== "automatic") return;
    cancelAutoAdvance();

    let remaining = Math.ceil(delayMs / 1000);
    setAutoAdvanceCountdown(remaining);

    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownIntervalRef.current) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
        }
        setAutoAdvanceCountdown(null);
      } else {
        setAutoAdvanceCountdown(remaining);
      }
    }, 1000);

    autoAdvanceTimerRef.current = setTimeout(() => {
      cancelAutoAdvance();
      handleNextQuestion();
    }, delayMs);
  };

  // Forward ref for voice command dispatcher to avoid stale closure
  const voiceCommandRef = useRef<(cmd: VoiceCommand, raw: string) => Promise<void>>(() => Promise.resolve());

  const voice = useVoice({
    context: {
      activeQuestion: currentQuestion,
      isQuestionAnswered: Boolean(latestEvaluation),
      selectedOption,
    },
    onCommand: (cmd, raw) => {
      voiceCommandRef.current(cmd, raw);
    },
    onSpeechEnd: () => {
      if (latestEvaluationRef.current && progressionModeRef.current === "automatic") {
        startAutoAdvance();
      }
    },
  });

  // Global keyboard shortcuts: Esc to stop speaking & cancel voice prompts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        voice.stopSpeaking();
        cancelAutoAdvance();
        setPendingVoiceSubmission(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [voice]);

  // Fetch initial learning history & server status on load
  useEffect(() => {
    let active = true;

    fetchInitialState()
      .then((data) => {
        if (!active) return;
        setMasteryList(data.masteryList);
        if (data.toolTraces && data.toolTraces.length > 0) {
          setToolTraces((prev) => [...data.toolTraces, ...prev]);
        }
      })
      .catch(() => {
        // Handled silently
      });

    fetchServerStatus()
      .then((status) => {
        if (!active) return;
        setServerStatus(status);
      })
      .catch(() => {
        // Handled silently
      });

    return () => {
      active = false;
    };
  }, []);

  const handleStartFromSetup = (config: SessionConfig) => {
    setIsSessionActive(true);
    if (config.documentId !== activeDocumentId) {
      setCurrentQuestion(undefined);
      setCurrentEvidence(undefined);
      setLatestEvaluation(undefined);
      latestEvaluationRef.current = undefined;
      setMessages([
        {
          id: `welcome-${config.documentId}`,
          role: "tutor",
          text: `Welcome! Starting study session on "${config.documentTitle}". All questions and explanations are strictly grounded in your notes.`,
        },
      ]);
      try {
        localStorage.removeItem("exam_sprint_active_session");
      } catch {
        // Non-fatal
      }
    }
    setActiveDocumentId(config.documentId);
    setActiveDocumentTitle(config.documentTitle);
    setActiveGoal(config.goal);
    if (config.suggestedTopics && config.suggestedTopics.length > 0) {
      setSuggestedTopics(config.suggestedTopics);
    } else {
      fetchDocumentTopics(config.documentId)
        .then((data) => setSuggestedTopics(data.topics))
        .catch(() => {});
    }
    handleStartTopic(config.topic, undefined, config.documentId, config.goal, config.documentTitle);
  };

  const handleResumeSession = () => {
    if (!savedSession) return;
    setIsSessionActive(true);
    setActiveDocumentId(savedSession.documentId);
    setActiveDocumentTitle(savedSession.documentTitle);
    setActiveGoal(savedSession.goal);
    setMessages(savedSession.messages);
    if (savedSession.question) setCurrentQuestion(savedSession.question);
    if (savedSession.evidence) setCurrentEvidence(savedSession.evidence);
    fetchDocumentTopics(savedSession.documentId)
      .then((data) => setSuggestedTopics(data.topics))
      .catch(() => {});
  };

  const handleStartTopic = async (
    topic?: string,
    focus?: "new" | "weak" | "review",
    docId?: string,
    goal?: LearningGoal,
    docTitle?: string,
    sectionOrdinal?: number,
  ) => {
    const requestId = ++latestRequestIdRef.current;
    const cleanTopic = (topic || "").trim();
    const isWeak = focus === "weak" || isWeakConceptsRequest(cleanTopic);
    const resolvedFocus = isWeak ? "weak" : focus;

    const effectiveDocId = docId || activeDocumentId;
    const effectiveGoal = goal || activeGoal;
    const effectiveTitle = docTitle || activeDocumentTitle;
    const effectiveOrdinal = sectionOrdinal !== undefined ? sectionOrdinal : currentSectionOrdinal;

    setIsLoading(true);
    setErrorMessage(undefined);

    const userMsgId = createMsgId("user");
    const userText = isWeak
      ? "Please review my weak concepts."
      : cleanTopic
        ? cleanTopic
        : effectiveGoal === "teach"
          ? `Teach me about ${effectiveTitle}`
          : effectiveGoal === "full_document"
            ? `Study ${effectiveTitle} section ${effectiveOrdinal}`
            : "Let's start a revision session.";

    const newMessages: MessageItem[] = [
      ...messages,
      { id: userMsgId, role: "user", text: userText, timestamp: createIsoTimestamp() },
    ];
    setMessages(newMessages);

    try {
      const res = await startSession({
        topic: isWeak ? "weak" : cleanTopic,
        focus: resolvedFocus,
        documentId: effectiveDocId,
        goal: effectiveGoal,
        sectionOrdinal: effectiveGoal === "full_document" ? effectiveOrdinal : undefined,
      });

      if (requestId !== latestRequestIdRef.current) {
        // Stale response from an earlier request discarded
        return;
      }

      let q: QuestionData | undefined = currentQuestion;
      let ev: EvidenceData | undefined = currentEvidence;

      if (res.question && res.evidence) {
        // Atomic consistent state transition: question and evidence are updated together
        setCurrentQuestion(res.question);
        setCurrentEvidence(res.evidence);
        setLatestEvaluation(undefined);
        latestEvaluationRef.current = undefined;
        setSelectedOption(undefined);
        setPendingVoiceSubmission(null);
        q = res.question;
        ev = res.evidence;
      } else if (!res.question) {
        // If question could not be generated (e.g. unsupported topic)
        setErrorMessage(res.message);
      }

      if (res.provider) {
        setCurrentProvider(res.provider);
      }
      if (res.executionMetadata) {
        setExecutionMetadata(res.executionMetadata);
      }

      setMasteryList(res.masteryList);
      if (res.toolTraces) {
        setToolTraces((prev) => [...res.toolTraces, ...prev]);
      }

      const finalMessages: MessageItem[] = [
        ...newMessages,
        {
          id: createMsgId("tutor"),
          role: "tutor",
          text: res.message,
          timestamp: createIsoTimestamp(),
        },
      ];
      setMessages(finalMessages);

      // Speak response aloud if voice output is enabled
      if (voice.voiceOutputEnabled) {
        if (res.question) {
          let spokenText = `${res.message}. Question: ${res.question.prompt}`;
          if (res.question.kind === "multiple_choice" && res.question.choices) {
            spokenText += ". Choices are: " + res.question.choices.map((c, i) => `Option ${String.fromCharCode(65 + i)}: ${c}`).join(". ");
          }
          voice.speak(spokenText);
        } else {
          voice.speak(res.message);
        }
      }

      // Persist active session state to localStorage
      try {
        localStorage.setItem(
          "exam_sprint_active_session",
          JSON.stringify({
            documentId: effectiveDocId,
            documentTitle: effectiveTitle,
            goal: effectiveGoal,
            topic: cleanTopic || undefined,
            messages: finalMessages,
            question: q,
            evidence: ev,
            savedAt: createIsoTimestamp(),
          } satisfies SavedSession),
        );
      } catch {
        // Non-fatal
      }
    } catch (err: unknown) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      const msg = err instanceof Error ? err.message : "Failed to start quiz session.";
      setErrorMessage(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: createMsgId("sys"),
          role: "system",
          text: `Error: ${msg}`,
          timestamp: createIsoTimestamp(),
        },
      ]);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleSubmitAnswer = async (answer: string) => {
    if (!currentQuestion) return;
    const activeQuestionId = currentQuestion.questionId;

    // Concurrent double-click guard: ignore duplicate in-flight invocation
    if (inFlightSubmissionRef.current) {
      return;
    }

    // Reuse stable clientAttemptId for retries of the exact same answer attempt; otherwise generate a new one
    let clientAttemptId: string;
    if (
      lastAttemptRef.current &&
      lastAttemptRef.current.questionId === activeQuestionId &&
      lastAttemptRef.current.answer === answer
    ) {
      clientAttemptId = lastAttemptRef.current.clientAttemptId;
    } else {
      clientAttemptId = createAttemptId(activeQuestionId);
      lastAttemptRef.current = { questionId: activeQuestionId, answer, clientAttemptId };
    }

    inFlightSubmissionRef.current = { questionId: activeQuestionId, answer, clientAttemptId };
    const requestId = ++latestRequestIdRef.current;

    setIsLoading(true);
    setErrorMessage(undefined);

    const userMsgId = createMsgId("user");
    const newMessages: MessageItem[] = [
      ...messages,
      { id: userMsgId, role: "user", text: answer, timestamp: createIsoTimestamp() },
    ];
    setMessages(newMessages);

    try {
      const res = await submitAnswer(activeQuestionId, answer, {
        clientAttemptId,
        documentId: activeDocumentId,
      });

      if (requestId !== latestRequestIdRef.current) {
        return;
      }

      // Successful completion clears retry attempt state
      lastAttemptRef.current = null;

      let q: QuestionData | undefined = currentQuestion;
      let ev: EvidenceData | undefined = currentEvidence;

      if (res.question && res.question.questionId !== activeQuestionId) {
        // Follow-up question provided: advance question and evidence consistently
        setCurrentQuestion(res.question);
        setCurrentEvidence(res.evidence || res.question.evidence);
        setLatestEvaluation(undefined);
        setSelectedOption(undefined);
        q = res.question;
        ev = res.evidence || res.question.evidence;
      } else {
        setLatestEvaluation(res.evaluation);
        if (res.evidence) {
          setCurrentEvidence(res.evidence);
          ev = res.evidence;
        }
      }
      if (res.provider) {
        setCurrentProvider(res.provider);
      }
      if (res.executionMetadata) {
        setExecutionMetadata(res.executionMetadata);
      }

      setMasteryList(res.masteryList);

      if (res.toolTraces) {
        setToolTraces((prev) => [...res.toolTraces, ...prev]);
      }

      const finalMessages: MessageItem[] = [
        ...newMessages,
        {
          id: createMsgId("tutor"),
          role: "tutor",
          text: res.message,
          timestamp: createIsoTimestamp(),
        },
      ];
      setMessages(finalMessages);

      // Speak evaluation explanation aloud if voice output is enabled
      if (voice.voiceOutputEnabled) {
        if (res.evaluation) {
          const verdictPrefix =
            res.evaluation.verdict === "correct"
              ? "Correct! "
              : res.evaluation.verdict === "partially_correct"
                ? "Partially correct. "
                : "Incorrect. ";
          voice.speak(`${verdictPrefix}${res.evaluation.explanation}`);
        } else {
          voice.speak(res.message);
        }
      }

      try {
        localStorage.setItem(
          "exam_sprint_active_session",
          JSON.stringify({
            documentId: activeDocumentId,
            documentTitle: activeDocumentTitle,
            goal: activeGoal,
            messages: finalMessages,
            question: q,
            evidence: ev,
            savedAt: createIsoTimestamp(),
          } satisfies SavedSession),
        );
      } catch {
        // Non-fatal
      }
    } catch (err: unknown) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      const msg = err instanceof Error ? err.message : "Failed to evaluate answer.";
      setErrorMessage(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: createMsgId("sys"),
          role: "system",
          text: `Error: ${msg}`,
          timestamp: createIsoTimestamp(),
        },
      ]);
    } finally {
      inFlightSubmissionRef.current = null;
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleNextQuestion = () => {
    cancelAutoAdvance();
    setSelectedOption(undefined);
    setLatestEvaluation(undefined);
    latestEvaluationRef.current = undefined;
    setPendingVoiceSubmission(null);
    if (activeGoal === "full_document") {
      const nextSec = currentSectionOrdinal + 1;
      setCurrentSectionOrdinal(nextSec);
      handleStartTopic("full_document", "new", activeDocumentId, "full_document", undefined, nextSec);
    } else if (activeGoal === "weak") {
      handleStartTopic("weak", "weak", activeDocumentId, "weak");
    } else if (currentQuestion) {
      handleStartTopic(currentQuestion.conceptId, "new", activeDocumentId, activeGoal);
    } else {
      handleStartTopic(suggestedTopics[0]?.topic ?? "", "new", activeDocumentId, activeGoal);
    }
  };

  const handleSwitchMode = (goal: LearningGoal) => {
    setActiveGoal(goal);
    cancelAutoAdvance();
    setSelectedOption(undefined);
    setLatestEvaluation(undefined);
    latestEvaluationRef.current = undefined;
    setPendingVoiceSubmission(null);
    if (goal === "weak") {
      handleStartTopic("weak", "weak", activeDocumentId, "weak");
    } else if (goal === "full_document") {
      setCurrentSectionOrdinal(1);
      handleStartTopic("full_document", "new", activeDocumentId, "full_document", undefined, 1);
    } else if (goal === "teach") {
      handleStartTopic(undefined, "new", activeDocumentId, "teach");
    } else {
      handleStartTopic(undefined, "new", activeDocumentId, "quiz");
    }
  };

  const handleAskStudyQuestion = async (query: string) => {
    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setErrorMessage(undefined);

    const userMsgId = createMsgId("user");
    const newMessages: MessageItem[] = [
      ...messages,
      { id: userMsgId, role: "user", text: query, timestamp: createIsoTimestamp() },
    ];
    setMessages(newMessages);

    try {
      const res = await startSession({
        topic: query,
        goal: "teach",
        documentId: activeDocumentId,
      });

      if (requestId !== latestRequestIdRef.current) return;

      if (res.evidence) {
        setCurrentEvidence(res.evidence);
      }
      if (res.provider) {
        setCurrentProvider(res.provider);
      }
      setMasteryList(res.masteryList);
      if (res.toolTraces) {
        setToolTraces((prev) => [...res.toolTraces, ...prev]);
      }

      const finalMessages: MessageItem[] = [
        ...newMessages,
        {
          id: createMsgId("tutor"),
          role: "tutor",
          text: res.message,
          timestamp: createIsoTimestamp(),
        },
      ];
      setMessages(finalMessages);

      if (voice.voiceOutputEnabled) {
        voice.speak(res.message);
      }
      // Note: active quiz question is intentionally preserved
    } catch (err: unknown) {
      if (requestId !== latestRequestIdRef.current) return;
      const msg = err instanceof Error ? err.message : "Failed to answer study question.";
      setErrorMessage(msg);
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleReviewWeak = () => {
    cancelAutoAdvance();
    setSelectedOption(undefined);
    setLatestEvaluation(undefined);
    handleStartTopic("weak", "weak");
  };

  // Wire conversational voice command interpreter
  useEffect(() => {
    voiceCommandRef.current = async (command: VoiceCommand, rawTranscript: string) => {
      switch (command.type) {
        case "select_option": {
          if (!currentQuestion) {
            const msg = "There is no active question to answer. Please select a topic or start a quiz first.";
            voice.speak(msg);
            setMessages((prev) => [
              ...prev,
              {
                id: `sys_no_q_${Date.now()}`,
                role: "system",
                text: msg,
                timestamp: new Date().toISOString(),
              },
            ]);
            return;
          }
          if (latestEvaluation) {
            const msg = command.isChange
              ? "This question has already been evaluated and recorded. Let's move to the next question."
              : "This question has already been evaluated. Say 'Next question' or select a new topic to continue.";
            voice.speak(msg);
            setMessages((prev) => [
              ...prev,
              {
                id: `sys_already_eval_${Date.now()}`,
                role: "system",
                text: msg,
                timestamp: new Date().toISOString(),
              },
            ]);
            return;
          }
          setSelectedOption(command.optionLetter);
          // Set pending voice confirmation banner with inspection and retry paths
          setPendingVoiceSubmission({
            optionLetter: command.optionLetter,
            rawTranscript: rawTranscript,
          });
          if (voice.voiceOutputEnabled) {
            voice.speak(`Selected option ${command.optionLetter}. Say 'Submit' or click Confirm to grade.`);
          }
          break;
        }
        case "submit_answer": {
          if (pendingVoiceSubmission) {
            const opt = pendingVoiceSubmission.optionLetter;
            setPendingVoiceSubmission(null);
            await handleSubmitAnswer(opt);
          } else if (currentQuestion && !latestEvaluation) {
            await handleSubmitAnswer(command.answerText);
          } else if (latestEvaluation) {
            voice.speak("This question has already been evaluated. Say 'Next question' to continue.");
          }
          break;
        }
        case "start_quiz": {
          cancelAutoAdvance();
          const target = command.topic || activeDocumentTitle || "quiz";
          await handleStartTopic(target, "new", activeDocumentId, "quiz");
          break;
        }
        case "next_question": {
          cancelAutoAdvance();
          handleNextQuestion();
          break;
        }
        case "previous_question": {
          voice.speak("You can review previous questions, answers, and verified quotes in the conversation history on the left.");
          break;
        }
        case "repeat_question": {
          if (currentQuestion) {
            let questionAudio = `Question: ${currentQuestion.prompt}.`;
            if (currentQuestion.kind === "multiple_choice" && currentQuestion.choices) {
              const choicesSpoken = currentQuestion.choices
                .map((c, i) => `Option ${String.fromCharCode(65 + i)}: ${c}`)
                .join(". ");
              questionAudio += ` Choices are: ${choicesSpoken}`;
            }
            setMessages((prev) => [
              ...prev,
              {
                id: `tutor_repeat_${Date.now()}`,
                role: "tutor",
                text: `Repeating question:\n\n"${currentQuestion.prompt}"${
                  currentQuestion.choices
                    ? "\n\n" + currentQuestion.choices.map((c, i) => `${String.fromCharCode(65 + i)}) ${c}`).join("\n")
                    : ""
                }`,
                timestamp: new Date().toISOString(),
              },
            ]);
            if (voice.voiceOutputEnabled) {
              voice.speak(questionAudio);
            }
          } else {
            const msg = "There is no active question right now.";
            setMessages((prev) => [
              ...prev,
              {
                id: `tutor_repeat_none_${Date.now()}`,
                role: "tutor",
                text: msg,
                timestamp: new Date().toISOString(),
              },
            ]);
            if (voice.voiceOutputEnabled) {
              voice.speak(msg);
            }
          }
          break;
        }
        case "read_options": {
          if (currentQuestion?.choices && currentQuestion.choices.length > 0) {
            const choicesSpoken = currentQuestion.choices
              .map((c, i) => `Option ${String.fromCharCode(65 + i)}: ${c}`)
              .join(". ");
            voice.speak(`The options are: ${choicesSpoken}`);
            setMessages((prev) => [
              ...prev,
              {
                id: `tutor_options_${Date.now()}`,
                role: "tutor",
                text: `Options:\n${currentQuestion.choices?.map((c, i) => `${String.fromCharCode(65 + i)}) ${c}`).join("\n")}`,
                timestamp: new Date().toISOString(),
              },
            ]);
          } else {
            voice.speak("There are no multiple-choice options available for this question.");
          }
          break;
        }
        case "repeat_explanation":
        case "explain_answer": {
          let responseText = "";
          const target = command.type === "explain_answer" ? command.target : undefined;
          if (latestEvaluation) {
            if (target === "why_wrong") {
              const isCorrect = latestEvaluation.verdict === "correct";
              responseText = isCorrect
                ? `Your answer was actually marked correct! Here is why: ${latestEvaluation.explanation}`
                : `Here is why your answer was marked ${latestEvaluation.verdict}: ${latestEvaluation.explanation}`;
            } else if (target === "why_correct") {
              responseText = `Here is why the correct answer is supported by your notes:\n\n${latestEvaluation.explanation}`;
            } else {
              const prefix =
                latestEvaluation.verdict === "correct"
                  ? "Your answer was correct! "
                  : "Here is the explanation: ";
              responseText = `${prefix}${latestEvaluation.explanation}`;
            }
            if (currentEvidence?.quote) {
              responseText += `\n\nVerified source note excerpt:\n"${currentEvidence.quote}"`;
            }
          } else if (currentQuestion) {
            responseText = "Please submit an answer first, or say 'Give me a hint' if you'd like a clue from the study notes!";
          } else {
            responseText = "Select a topic or start a quiz to explore explanations.";
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `tutor_explain_${Date.now()}`,
              role: "tutor",
              text: responseText,
              timestamp: new Date().toISOString(),
            },
          ]);
          if (voice.voiceOutputEnabled) {
            voice.speak(responseText);
          }
          break;
        }
        case "simplify_explanation": {
          let responseText = "";
          if (latestEvaluation?.explanation) {
            const firstSentence = latestEvaluation.explanation.split(/[.!?]/)[0] || latestEvaluation.explanation;
            responseText = `In simpler terms: ${firstSentence.trim()}.`;
            if (currentEvidence?.quote) {
              responseText += `\n\nCore fact: "${currentEvidence.quote.slice(0, 140)}"`;
            }
          } else if (currentEvidence?.quote) {
            responseText = `In simpler terms, this section is about: "${currentEvidence.quote.slice(0, 140)}"`;
          } else {
            responseText = "I don't have an explanation to simplify yet. Let's work on the active question first.";
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `tutor_simplify_${Date.now()}`,
              role: "tutor",
              text: responseText,
              timestamp: new Date().toISOString(),
            },
          ]);
          if (voice.voiceOutputEnabled) {
            voice.speak(responseText);
          }
          break;
        }
        case "request_example": {
          let responseText = "";
          if (currentEvidence?.quote) {
            responseText = `Here is an illustrative example applying this concept:\n\n` +
              `Suppose a database stores customer orders. To satisfy this rule, every non-key attribute must depend directly on the primary key, avoiding anomalies when updating records.\n\n` +
              `Grounded in verified note fact:\n"${currentEvidence.quote.slice(0, 150)}"`;
          } else if (currentQuestion) {
            responseText = `Consider how this applies in practice to: "${currentQuestion.prompt}". In real-world system design, this rule ensures data integrity.`;
          } else {
            responseText = "Select a topic first to explore practical examples.";
          }
          setMessages((prev) => [
            ...prev,
            {
              id: `tutor_example_${Date.now()}`,
              role: "tutor",
              text: responseText,
              timestamp: new Date().toISOString(),
            },
          ]);
          if (voice.voiceOutputEnabled) {
            voice.speak(responseText);
          }
          break;
        }
        case "give_hint": {
          if (currentEvidence?.quote) {
            const hint = `Here is a hint from your study notes: "${currentEvidence.quote.slice(0, 140)}..."`;
            voice.speak(hint);
            setMessages((prev) => [
              ...prev,
              {
                id: `tutor_hint_${Date.now()}`,
                role: "tutor",
                text: `💡 ${hint}`,
                timestamp: new Date().toISOString(),
              },
            ]);
          } else {
            voice.speak("I don't have an evidence passage to give a hint from right now.");
          }
          break;
        }
        case "ask_study_question": {
          await handleAskStudyQuestion(command.query);
          break;
        }
        case "teach_topic": {
          cancelAutoAdvance();
          await handleStartTopic(command.topic, "new", activeDocumentId, "teach");
          break;
        }
        case "quiz_topic": {
          cancelAutoAdvance();
          await handleStartTopic(command.topic, "new", activeDocumentId, "quiz");
          break;
        }
        case "review_weak": {
          handleReviewWeak();
          break;
        }
        case "study_full_document": {
          cancelAutoAdvance();
          setActiveGoal("full_document");
          setCurrentSectionOrdinal(1);
          await handleStartTopic("full_document", "new", activeDocumentId, "full_document", undefined, 1);
          break;
        }
        case "change_mode": {
          setProgressionMode(command.mode);
          if (command.mode === "guided") {
            cancelAutoAdvance();
            voice.speak("Switched to Guided progression mode. I will wait for your command before advancing.");
          } else {
            voice.speak("Switched to Automatic progression mode. Questions will advance after feedback.");
          }
          break;
        }
        case "pause": {
          cancelAutoAdvance();
          voice.stopListening();
          voice.speak("Voice paused. Say 'Resume' or click the microphone to resume.");
          break;
        }
        case "resume": {
          voice.startListening();
          voice.speak("Voice resumed. I'm listening.");
          break;
        }
        case "clarify": {
          voice.speak(command.clarificationPrompt);
          setMessages((prev) => [
            ...prev,
            {
              id: `sys_clarify_${Date.now()}`,
              role: "system",
              text: command.clarificationPrompt,
              timestamp: new Date().toISOString(),
            },
          ]);
          break;
        }
        case "dont_know": {
          if (currentQuestion && !latestEvaluation) {
            await handleSubmitAnswer("I don't know");
          } else {
            voice.speak("No worries! Select a topic or ask a question whenever you are ready.");
          }
          break;
        }
        case "stop_voice": {
          cancelAutoAdvance();
          voice.stopListening();
          voice.speak("Voice mode stopped.");
          setMessages((prev) => [
            ...prev,
            {
              id: `sys_stop_${Date.now()}`,
              role: "system",
              text: "Voice mode stopped.",
              timestamp: new Date().toISOString(),
            },
          ]);
          break;
        }
        case "ambiguous": {
          voice.speak(command.reason);
          setMessages((prev) => [
            ...prev,
            {
              id: `sys_ambig_${Date.now()}`,
              role: "system",
              text: command.reason,
              timestamp: new Date().toISOString(),
            },
          ]);
          break;
        }
        case "unknown": {
          if (rawTranscript.trim()) {
            await handleStartTopic(rawTranscript.trim());
          }
          break;
        }
      }
    };
  });

  const handleUserMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Check if user is confirming pending voice submission
    if (pendingVoiceSubmission && /^(?:yes|confirm|submit|go|proceed)$/i.test(trimmed)) {
      const opt = pendingVoiceSubmission.optionLetter;
      setPendingVoiceSubmission(null);
      await handleSubmitAnswer(opt);
      return;
    }

    // Echo the user's message into conversation first so user sees their input immediately
    const userMsgId = `user_${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", text: trimmed, timestamp: new Date().toISOString() },
    ]);

    // First: classify through voice command parser before initiating any note search
    const command = parseVoiceCommand(trimmed, {
      activeQuestion: currentQuestion,
      isQuestionAnswered: Boolean(latestEvaluation),
      selectedOption,
    });

    if (command.type !== "unknown") {
      await voiceCommandRef.current(command, trimmed);
      return;
    }

    // Only non-commands search study notes for topic practice
    await handleStartTopic(trimmed);
  };

  const handleExplainSimply = () => {
    if (latestEvaluation?.explanation) {
      const text = `In simpler terms: ${latestEvaluation.explanation.split(".")[0]}.`;
      setMessages((prev) => [
        ...prev,
        { id: `tutor_${Date.now()}`, role: "tutor", text, timestamp: new Date().toISOString() },
      ]);
      if (voice.voiceOutputEnabled) voice.speak(text);
    } else if (currentEvidence?.quote) {
      handleAskStudyQuestion(`Explain this in simpler terms: "${currentEvidence.quote.slice(0, 100)}"`);
    }
  };

  const handleGiveExample = () => {
    if (currentEvidence?.quote) {
      handleAskStudyQuestion(`Can you give an illustrative example of this concept from the notes: "${currentEvidence.quote.slice(0, 100)}"?`);
    } else if (currentQuestion) {
      handleAskStudyQuestion(`Can you give an example for: "${currentQuestion.prompt}"?`);
    }
  };

  const handleQuizMeOnEvidence = () => {
    if (currentQuestion?.conceptId) {
      handleStartTopic(currentQuestion.conceptId, "new", activeDocumentId, "quiz");
    } else if (suggestedTopics[0]?.topic) {
      handleStartTopic(suggestedTopics[0].topic, "new", activeDocumentId, "quiz");
    }
  };

  const handleChallengeCompleted = (
    _updated: MasteryConcept[],
    traces: ToolTraceEntry[],
  ) => {
    fetchInitialState()
      .then((data) => {
        setMasteryList(data.masteryList);
        if (traces.length > 0) {
          setToolTraces((prev) => [...traces, ...prev]);
        }
      })
      .catch(() => {
        // Non-fatal
      });
  };

  const hasWeakConcepts = masteryList.some(
    (m) => m.openMisconceptions.length > 0 || (m.attemptsCount > 0 && m.mastery < 0.5),
  );

  const isAiLive =
    executionMetadata?.executionPath === "live_model" ||
    (currentProvider === "llm" && Boolean(serverStatus?.reachable && serverStatus.provider?.configured && !executionMetadata));
  const modelName =
    executionMetadata?.model ||
    (serverStatus?.reachable ? serverStatus.provider?.model || "gemini-3.8-flash" : "gemini-3.8-flash");

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      {/* Top Command Center Header Bar */}
      <header className="warm-glass-panel rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-lg shrink-0 border border-stone-800/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-500 to-orange-600 text-stone-950 font-bold text-sm shadow-md shadow-amber-950/40">
              ⚡
            </span>
            <div>
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-stone-100 flex items-center gap-2">
                <span>StudyFlow</span>
                <span className="text-[10px] uppercase font-mono font-semibold px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300">
                  Adaptive AI Tutor
                </span>
              </h1>
              <p className="text-[11px] text-stone-400 hidden sm:block">
                Adaptive revision grounded in verified note quotations
              </p>
            </div>
          </div>
        </div>

        {/* Status Chips, Active Material, & Rapid-Fire Trigger */}
        <div className="flex items-center gap-2.5">
          {/* Learning Mode Switcher Pills */}
          {isSessionActive && (
            <div
              className="flex items-center gap-1 bg-stone-950/80 p-0.5 rounded-xl border border-stone-800 text-xs"
              role="tablist"
              aria-label="Learning Modes"
            >
              {(["teach", "quiz", "weak", "full_document"] as LearningGoal[]).map((goal) => {
                const isSelected = activeGoal === goal;
                return (
                  <button
                    key={goal}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => handleSwitchMode(goal)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm font-semibold"
                        : "text-stone-400 hover:text-stone-200 hover:bg-stone-900 border border-transparent"
                    }`}
                    title={`Switch mode to ${GOAL_LABELS[goal].label}`}
                  >
                    <span aria-hidden="true">{GOAL_LABELS[goal].icon}</span>
                    <span className="hidden sm:inline">{GOAL_LABELS[goal].label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Stop Speaking Voice Control */}
          {voice.voiceState === "speaking" && (
            <button
              type="button"
              onClick={() => voice.stopSpeaking()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/30 transition-all shadow-sm"
              title="Stop speaking (Esc)"
              aria-label="Stop tutor speaking"
            >
              <span className="size-2 rounded-full bg-rose-400 animate-ping" />
              <span>Stop Speaking</span>
              <kbd className="hidden sm:inline text-[9px] px-1 py-0.5 bg-stone-900/80 border border-rose-500/30 rounded text-rose-200">Esc</kbd>
            </button>
          )}

          {/* Active Material Badge */}
          {isSessionActive && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900 border border-stone-800 text-xs text-stone-300">
              <BookOpen className="size-3 text-amber-400" />
              <span className="text-[10px] text-stone-500 uppercase font-bold hidden sm:inline">Material:</span>
              <span className="font-semibold text-amber-300 max-w-[130px] truncate" title={activeDocumentTitle}>
                {activeDocumentTitle}
              </span>
              <button
                type="button"
                onClick={() => setIsSessionActive(false)}
                title="Change study material or learning goal"
                className="ml-1 text-[10px] text-stone-400 hover:text-amber-300 underline font-medium"
              >
                Change
              </button>
            </div>
          )}

          {/* Active Response Engine Badge */}
          <div
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-stone-900/80 border border-stone-800 text-xs text-stone-300"
            title={
              isAiLive
                ? `Active Model: ${modelName} (${executionMetadata?.callCount ?? 1} tool calls)`
                : `Engine: Deterministic Fallback (${executionMetadata?.fallbackReason || "Offline/local mode"})`
            }
          >
            <span className={`size-2 rounded-full ${isAiLive ? "bg-amber-400 animate-ping" : "bg-stone-500"}`} />
            <Activity className="size-3 text-amber-400" />
            <span className="font-medium text-[11px]">
              {isAiLive ? `Response: Live AI (${modelName})` : "Response: Deterministic Engine"}
            </span>
          </div>

          {/* Evidence Security Badge */}
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#131916] border border-emerald-500/30 text-xs text-emerald-300">
            <ShieldCheck className="size-3 text-emerald-400" />
            <span className="font-medium text-[11px]">Verified Evidence Gated</span>
          </div>

          {/* Rapid-Fire Sprint Button */}
          <button
            type="button"
            onClick={() => setIsChallengeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-3 py-1.5 text-xs font-bold text-stone-950 shadow-md shadow-amber-950/40 hover:opacity-95 transition-all"
          >
            <Zap className="size-3.5 fill-stone-950" />
            <span>Rapid-Fire Sprint</span>
          </button>
        </div>
      </header>

      {/* Error Alert */}
      {errorMessage && (
        <div
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center justify-between shrink-0"
          role="alert"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(undefined)}
            className="font-bold px-1 hover:opacity-75"
          >
            ✕
          </button>
        </div>
      )}

      {/* Rapid-Fire Redemption Modal */}
      <RapidFireChallenge
        isOpen={isChallengeOpen}
        onClose={() => {
          setIsChallengeOpen(false);
          fetchInitialState()
            .then((data) => setMasteryList(data.masteryList))
            .catch(() => {});
        }}
        masteryList={masteryList}
        onChallengeCompleted={handleChallengeCompleted}
      />

      {/* Main View: SetupScreen when no active session, Command Center when session is active */}
      {!isSessionActive ? (
        <SetupScreen
          onStartSession={handleStartFromSetup}
          previousSession={
            savedSession
              ? {
                  documentId: savedSession.documentId,
                  documentTitle: savedSession.documentTitle,
                  goal: savedSession.goal,
                  topic: savedSession.topic,
                  messageCount: savedSession.messages.length,
                }
              : null
          }
          onResumeSession={handleResumeSession}
        />
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden">
          {/* Left Column — AI Tutor */}
          <div className="lg:col-span-4 h-full flex flex-col min-h-0 overflow-hidden">
            <ConversationPanel
              messages={messages}
              onSendMessage={(text) => handleUserMessage(text)}
              onStartTopic={(t) => handleStartTopic(t)}
              onReviewWeak={handleReviewWeak}
              onStartChallenge={() => setIsChallengeOpen(true)}
              isLoading={isLoading}
              hasWeakConcepts={hasWeakConcepts}
              providerType={isAiLive ? "llm" : "deterministic_fallback"}
              modelName={modelName}
              activeMaterialTitle={activeDocumentTitle}
              activeGoal={activeGoal}
              suggestedTopics={suggestedTopics}
              voiceController={voice}
              progressionMode={progressionMode}
              onToggleProgressionMode={() =>
                setProgressionMode((prev) => (prev === "guided" ? "automatic" : "guided"))
              }
              autoAdvanceCountdown={autoAdvanceCountdown}
              onCancelAutoAdvance={cancelAutoAdvance}
            />
          </div>

          {/* Center Column — Learning Stage */}
          <div className="lg:col-span-4 h-full flex flex-col min-h-0 gap-3.5 overflow-y-auto pr-0.5">
            {/* Spoken Voice Confirmation Banner */}
            {pendingVoiceSubmission && (
              <div
                data-testid="voice-transcript-confirmation"
                className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-2.5 shadow-md shrink-0"
              >
                <div className="flex items-center gap-2 text-xs text-amber-200">
                  <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                  <span>
                    Voice heard: <strong>Option {pendingVoiceSubmission.optionLetter}</strong>{" "}
                    <span className="text-stone-400 italic">(&ldquo;{pendingVoiceSubmission.rawTranscript}&rdquo;)</span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const opt = pendingVoiceSubmission.optionLetter;
                      setPendingVoiceSubmission(null);
                      handleSubmitAnswer(opt);
                    }}
                    className="px-2.5 py-1 rounded-md bg-amber-500 text-stone-950 text-xs font-bold hover:bg-amber-400 transition-colors shadow-sm"
                  >
                    Confirm & Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingVoiceSubmission(null);
                      voice.startListening();
                    }}
                    className="px-2 py-1 rounded-md bg-stone-800 text-stone-300 text-xs hover:bg-stone-700 transition-colors"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingVoiceSubmission(null)}
                    className="px-2 py-1 rounded-md text-stone-400 hover:text-stone-200 text-xs"
                    aria-label="Dismiss voice confirmation"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <QuizCard
              key={currentQuestion?.questionId ?? "empty"}
              question={currentQuestion}
              evaluation={latestEvaluation}
              onSubmitAnswer={handleSubmitAnswer}
              onNextQuestion={handleNextQuestion}
              isLoading={isLoading}
              selectedOption={selectedOption}
              progressionMode={progressionMode}
              autoAdvanceCountdown={autoAdvanceCountdown}
              onCancelAutoAdvance={cancelAutoAdvance}
            />
            <EvidenceCard
              evidence={currentEvidence}
              recoveryCitation={latestEvaluation?.recoveryCitation}
              activeDocumentTitle={activeDocumentTitle}
              isAnswered={Boolean(latestEvaluation)}
              activeGoal={activeGoal}
              onExplainSimply={handleExplainSimply}
              onGiveExample={handleGiveExample}
              onQuizMe={handleQuizMeOnEvidence}
            />
          </div>

          {/* Right Column — Student Mastery & Server Diagnostics */}
          <div className="lg:col-span-4 h-full flex flex-col min-h-0 gap-3.5 overflow-y-auto pr-0.5">
            <div className="shrink-0">
              <MasteryPanel
                masteryList={masteryList}
                onSelectConcept={(conceptId) => handleStartTopic(conceptId)}
                onStartChallenge={() => setIsChallengeOpen(true)}
              />
            </div>
            <div className="shrink-0 flex flex-col gap-2">
              <ServerStatus toolTraces={toolTraces} lastResponseEngine={currentProvider} />
              <button
                type="button"
                onClick={() => setShowStatusChecklist(!showStatusChecklist)}
                className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-stone-800 bg-stone-900/50 text-xs text-stone-400 hover:text-stone-200 transition-colors"
              >
                <span>Milestone Roadmap & Checklist</span>
                {showStatusChecklist ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
              {showStatusChecklist && (
                <div className="max-h-56 overflow-y-auto border border-stone-800 rounded-xl bg-stone-950 p-2.5">
                  <StatusChecklist />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
