/**
 * Hybrid Voice Command Parser and Intent Router for StudyFlow / Exam Sprint.
 *
 * Implements a hybrid intent recognition architecture:
 * - Deterministic fast path for unambiguous control commands.
 * - Typed structured output with intent, confidence, arguments, and clarification flags.
 * - Conversational context tracking (e.g. "Why?", "Explain that again", "What about option B?").
 * - Pre-submission validation to protect against out-of-range options, duplicate submissions,
 *   and submitting already-evaluated questions.
 *
 * Note: This parser DOES NOT grade answers. Answer evaluation is strictly server-side.
 */

import type { QuestionData } from "./api-client";

export type VoiceIntent =
  | "SELECT_OPTION"
  | "SUBMIT_ANSWER"
  | "START_QUIZ"
  | "NEXT_QUESTION"
  | "PREVIOUS_QUESTION"
  | "REPEAT_QUESTION"
  | "READ_OPTIONS"
  | "EXPLAIN_ANSWER"
  | "ASK_STUDY_QUESTION"
  | "REQUEST_HINT"
  | "REQUEST_EXAMPLE"
  | "SIMPLIFY_EXPLANATION"
  | "CHANGE_TOPIC"
  | "PAUSE"
  | "RESUME"
  | "STOP_VOICE"
  | "CHANGE_MODE"
  | "CLARIFY";

export interface IntentArgs {
  optionLetter?: "A" | "B" | "C" | "D" | "E";
  originalChoiceText?: string;
  isChange?: boolean;
  answerText?: string;
  topic?: string;
  isQuiz?: boolean;
  mode?: "guided" | "automatic";
  target?: "why" | "why_wrong" | "why_correct" | "general";
  query?: string;
  conceptId?: string;
}

export interface IntentClassification {
  intent: VoiceIntent;
  confidence: number;
  args?: IntentArgs;
  needsClarification: boolean;
  clarificationPrompt?: string;
  questionId?: string;
  reason?: string;
  rawTranscript: string;
}

export type VoiceCommand =
  | { type: "select_option"; optionLetter: "A" | "B" | "C" | "D" | "E"; originalChoiceText?: string; isChange?: boolean }
  | { type: "submit_answer"; answerText: string }
  | { type: "start_quiz"; topic?: string }
  | { type: "next_question" }
  | { type: "previous_question" }
  | { type: "repeat_question" }
  | { type: "read_options" }
  | { type: "explain_answer"; target?: "why" | "why_wrong" | "why_correct" | "general" }
  | { type: "repeat_explanation" }
  | { type: "ask_study_question"; query: string }
  | { type: "give_hint" }
  | { type: "request_example" }
  | { type: "simplify_explanation" }
  | { type: "teach_topic"; topic: string }
  | { type: "quiz_topic"; topic: string }
  | { type: "review_weak" }
  | { type: "study_full_document" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop_voice" }
  | { type: "change_mode"; mode: "guided" | "automatic" }
  | { type: "clarify"; reason: string; clarificationPrompt: string }
  | { type: "dont_know" }
  | { type: "ambiguous"; rawTranscript: string; reason: string }
  | { type: "unknown"; rawTranscript: string };

export interface CommandParserContext {
  activeQuestion?: QuestionData;
  isQuestionAnswered?: boolean;
  selectedOption?: string;
  lastTutorMessage?: string;
  lastEvaluationSummary?: string;
}

/**
 * Regex matching wake phrases:
 * - "hey exam sprint", "ok exam sprint", "okay exam sprint", "exam sprint"
 * - "hey studyflow", "study flow", "hey sprint"
 */
export const WAKE_PHRASE_REGEX =
  /^(?:hey|ok|okay|hi)?\s*(?:exam\s*sprint|study\s*flow|sprint)[,.:;!?-]*/i;

/**
 * Extracts any leading wake phrase from a transcript and returns whether
 * a wake phrase was present and any remaining command text.
 */
export function extractWakePhraseAndCommand(transcript: string): {
  hasWakePhrase: boolean;
  remainingCommand: string;
} {
  const trimmed = transcript.trim();
  const match = trimmed.match(WAKE_PHRASE_REGEX);

  if (!match) {
    return {
      hasWakePhrase: false,
      remainingCommand: trimmed,
    };
  }

  const matchedPhrase = match[0];
  const remaining = trimmed.slice(matchedPhrase.length).replace(/^[,.:;!?-]+/, "").trim();

  return {
    hasWakePhrase: true,
    remainingCommand: remaining,
  };
}

/**
 * Normalizes speech recognition phonetic letter variants:
 * e.g., "ay", "eh" -> "A", "bee", "be" -> "B", "see", "sea" -> "C", "dee" -> "D".
 */
export function normalizeSpokenLetter(raw: string): string {
  const token = raw.trim().toLowerCase();
  switch (token) {
    case "ay":
    case "eh":
    case "a":
      return "A";
    case "bee":
    case "be":
    case "b":
      return "B";
    case "see":
    case "sea":
    case "c":
      return "C";
    case "dee":
    case "d":
      return "D";
    case "e":
      return "E";
    default:
      return token.toUpperCase();
  }
}

/**
 * Clean transcript by removing punctuation and leading/trailing whitespace.
 */
export function cleanTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Hybrid Intent Classifier with typed structured outputs.
 */
export function classifyIntent(
  rawTranscript: string,
  context: CommandParserContext = {},
): IntentClassification {
  const { remainingCommand } = extractWakePhraseAndCommand(rawTranscript);
  const normalized = cleanTranscript(remainingCommand || rawTranscript);

  if (!normalized) {
    return {
      intent: "CLARIFY",
      confidence: 0,
      needsClarification: true,
      clarificationPrompt: "I didn't hear a command. Please say 'Hey Exam Sprint' or ask a question.",
      rawTranscript,
    };
  }

  // 1. Session control & Mode changes
  if (/^(?:stop\s+voice|stop\s+listening|disable\s+voice|turn\s+off\s+voice|stop|cancel\s+voice)$/i.test(normalized)) {
    return {
      intent: "STOP_VOICE",
      confidence: 1.0,
      needsClarification: false,
      rawTranscript,
    };
  }

  if (/^(?:pause(?:\s+voice|\s+session)?|hold\s+on)$/i.test(normalized)) {
    return {
      intent: "PAUSE",
      confidence: 0.95,
      needsClarification: false,
      rawTranscript,
    };
  }

  if (/^(?:resume(?:\s+voice|\s+session)?|continue\s+voice|unpause)$/i.test(normalized)) {
    return {
      intent: "RESUME",
      confidence: 0.95,
      needsClarification: false,
      rawTranscript,
    };
  }

  if (/(?:switch\s+to\s+auto(?:matic)?(?:\s+mode)?|enable\s+auto(?:matic)?\s+advance|auto\s+advance(?:\s+mode)?)/i.test(normalized)) {
    return {
      intent: "CHANGE_MODE",
      confidence: 0.95,
      args: { mode: "automatic" },
      needsClarification: false,
      rawTranscript,
    };
  }

  if (/(?:switch\s+to\s+guided(?:\s+mode)?|enable\s+guided\s+mode|guided\s+mode)/i.test(normalized)) {
    return {
      intent: "CHANGE_MODE",
      confidence: 0.95,
      args: { mode: "guided" },
      needsClarification: false,
      rawTranscript,
    };
  }

  // 2. Quiz Progression & Navigation
  if (
    /^(?:next\s+question|go\s+to\s+next\s+question|next\s+one|next|advance|continue|move\s+on)$/i.test(normalized) ||
    /^next\s+question\s+please$/i.test(normalized)
  ) {
    return {
      intent: "NEXT_QUESTION",
      confidence: 0.98,
      needsClarification: false,
      questionId: context.activeQuestion?.questionId,
      rawTranscript,
    };
  }

  if (/^(?:previous\s+question|go\s+back(?:\s+to\s+previous)?|previous|back)$/i.test(normalized)) {
    return {
      intent: "PREVIOUS_QUESTION",
      confidence: 0.95,
      needsClarification: false,
      rawTranscript,
    };
  }

  if (
    /^(?:please\s+)?(?:repeat|read|say|what\s+is|what's)(?:\s+(?:the|this|current))?\s+question(?:\s+please)?$/i.test(normalized) ||
    /^(?:please\s+)?repeat\s+question(?:\s+please)?$/i.test(normalized) ||
    /^(?:please\s+)?read\s+it\s+again(?:\s+please)?$/i.test(normalized)
  ) {
    return {
      intent: "REPEAT_QUESTION",
      confidence: 0.98,
      needsClarification: false,
      questionId: context.activeQuestion?.questionId,
      rawTranscript,
    };
  }

  if (
    /^(?:please\s+)?(?:read|say|what\s+are|list)(?:\s+(?:the|all))?\s+(?:options|choices)(?:\s+please)?$/i.test(normalized) ||
    /^(?:please\s+)?read\s+options(?:\s+please)?$/i.test(normalized) ||
    /^(?:please\s+)?read\s+choices(?:\s+please)?$/i.test(normalized)
  ) {
    return {
      intent: "READ_OPTIONS",
      confidence: 0.98,
      needsClarification: false,
      questionId: context.activeQuestion?.questionId,
      rawTranscript,
    };
  }

  // 3. Educational Explanations & Follow-ups
  if (
    /^(?:i\s+)?don'?t\s+know(?:\s+(?:the\s+)?answer)?$/i.test(normalized) ||
    /^(?:i\s+have\s+)?no\s+idea$/i.test(normalized) ||
    /^(?:skip|pass)(?:\s+(?:this|the)\s+question)?$/i.test(normalized) ||
    /^not\s+sure$/i.test(normalized)
  ) {
    return {
      intent: "ASK_STUDY_QUESTION",
      confidence: 0.95,
      args: { target: "general", query: "dont_know" },
      needsClarification: false,
      rawTranscript,
    };
  }

  if (
    /^(?:why\s+was\s+my\s+answer\s+(?:wrong|incorrect)|why\s+did\s+i\s+get\s+that\s+wrong|why\s+is\s+that\s+(?:wrong|incorrect))$/i.test(normalized)
  ) {
    return {
      intent: "EXPLAIN_ANSWER",
      confidence: 0.95,
      args: { target: "why_wrong" },
      needsClarification: false,
      rawTranscript,
    };
  }

  const whyCorrectMatch = normalized.match(/^(?:why\s+is\s+(?:option\s+)?([a-e]|ay|eh|bee|see|sea|dee)\s+correct)$/i);
  if (whyCorrectMatch && whyCorrectMatch[1]) {
    const letter = normalizeSpokenLetter(whyCorrectMatch[1]) as "A" | "B" | "C" | "D" | "E";
    return {
      intent: "EXPLAIN_ANSWER",
      confidence: 0.95,
      args: { target: "why_correct", optionLetter: letter },
      needsClarification: false,
      rawTranscript,
    };
  }

  if (
    /^(?:why(?:\s+is\s+that)?|explain\s+(?:that|this)?\s+again|explain\s+why|repeat\s+(?:the\s+)?explanation|why\s+though)$/i.test(normalized)
  ) {
    return {
      intent: "EXPLAIN_ANSWER",
      confidence: 0.92,
      args: { target: "why" },
      needsClarification: false,
      rawTranscript,
    };
  }

  if (
    /^(?:explain(?:\s+this)?(?:\s+topic)?\s+more\s+simply|in\s+simple\s+terms|simpler\s+please|simplify(?:\s+this)?|eli5|explain\s+like\s+i'm\s+five)$/i.test(
      normalized,
    )
  ) {
    return {
      intent: "SIMPLIFY_EXPLANATION",
      confidence: 0.95,
      needsClarification: false,
      rawTranscript,
    };
  }

  if (
    /^(?:give(?:\s+me)?\s+(?:an\s+)?example|can\s+you\s+give\s+(?:an\s+)?example|provide\s+(?:an\s+)?example|example\s+please)$/i.test(
      normalized,
    )
  ) {
    return {
      intent: "REQUEST_EXAMPLE",
      confidence: 0.95,
      needsClarification: false,
      rawTranscript,
    };
  }

  if (/^(?:give(?:\s+me)?|show(?:\s+me)?|can\s+i\s+get|i\s+need|give)?\s*(?:a\s+)?hint(?:\s+please)?$/i.test(normalized)) {
    return {
      intent: "REQUEST_HINT",
      confidence: 0.95,
      needsClarification: false,
      questionId: context.activeQuestion?.questionId,
      rawTranscript,
    };
  }

  // 4. Relative/Ordinal Ambiguity Check (e.g. "the second one", "first option")
  const ordinalMatch = normalized.match(
    /^(?:i\s+think\s+)?(?:the\s+)?(first|second|third|fourth|fifth|last)(?:\s+(?:one|option|choice))?$/i,
  );
  if (ordinalMatch && ordinalMatch[1]) {
    const term = ordinalMatch[1].toLowerCase();
    const mapOrdinal: Record<string, "A" | "B" | "C" | "D" | "E"> = {
      first: "A",
      second: "B",
      third: "C",
      fourth: "D",
      fifth: "E",
    };
    const mapped = mapOrdinal[term];
    return {
      intent: "CLARIFY",
      confidence: 0.5,
      needsClarification: true,
      clarificationPrompt: mapped
        ? `Did you mean option ${mapped}? Please say 'Select option ${mapped}' to confirm.`
        : "Which option would you like to select? Please say 'Select option A', 'B', 'C', or 'D'.",
      rawTranscript,
    };
  }

  // 5. Answer Change: "Change my answer to C"
  const changeMatch = normalized.match(
    /^(?:change(?:\s+my)?\s+answer\s+to|change\s+to|switch\s+to)\s*(?:option|choice)?\s*([a-z]+)\b/i,
  );
  if (changeMatch && changeMatch[1]) {
    const letter = normalizeSpokenLetter(changeMatch[1]) as "A" | "B" | "C" | "D" | "E";

    if (!context.activeQuestion) {
      return {
        intent: "CLARIFY",
        confidence: 0.9,
        needsClarification: true,
        clarificationPrompt: "There is no active question to answer. Please select a topic or start a quiz first.",
        rawTranscript,
      };
    }

    if (context.isQuestionAnswered) {
      return {
        intent: "CLARIFY",
        confidence: 0.9,
        needsClarification: true,
        clarificationPrompt: "This question has already been evaluated and cannot be changed. Say 'Next question' to proceed.",
        rawTranscript,
      };
    }

    return {
      intent: "SELECT_OPTION",
      confidence: 0.95,
      args: { optionLetter: letter, isChange: true },
      needsClarification: false,
      questionId: context.activeQuestion.questionId,
      rawTranscript,
    };
  }

  // 6. Conflicting options check: e.g. "Select A or B"
  const potentialLetters = Array.from(
    normalized.matchAll(/\b([a-e]|ay|eh|bee|see|sea|dee)\b/gi),
  )
    .map((m) => normalizeSpokenLetter(m[1] || ""))
    .filter((l) => ["A", "B", "C", "D", "E"].includes(l));

  const uniqueLetters = Array.from(new Set(potentialLetters));
  if (uniqueLetters.length > 1 && context.activeQuestion?.kind === "multiple_choice") {
    return {
      intent: "CLARIFY",
      confidence: 0.9,
      needsClarification: true,
      clarificationPrompt: "Multiple conflicting choices heard. Please say 'Select option A', 'B', 'C', or 'D'.",
      rawTranscript,
    };
  }

  // 7. Explicit Option Selection
  const optionRegex =
    /^(?:lock\s+in|i\s+choose|select|choose|pick|submit|mark|go\s+with|my\s+answer\s+is|answer\s+is|answer)\s*(?:option|choice|letter|answer)?\s*([a-z]+)\b/i;
  const optionPrefixRegex = /^(?:option|choice|letter)\s*([a-z]+)\b/i;
  const standaloneLetterRegex = /^(?:it\s+is\s+|it's\s+)?([a-z]+)$/i;

  const optionMatch =
    normalized.match(optionRegex) ||
    normalized.match(optionPrefixRegex) ||
    (context.activeQuestion?.kind === "multiple_choice" && !context.isQuestionAnswered
      ? normalized.match(standaloneLetterRegex)
      : null);

  if (optionMatch && optionMatch[1]) {
    const letter = normalizeSpokenLetter(optionMatch[1]) as "A" | "B" | "C" | "D" | "E";

    if (!context.activeQuestion) {
      return {
        intent: "CLARIFY",
        confidence: 0.9,
        needsClarification: true,
        clarificationPrompt: "There is no active question to answer. Please select a topic or start a quiz first.",
        rawTranscript,
      };
    }

    if (context.isQuestionAnswered) {
      return {
        intent: "CLARIFY",
        confidence: 0.9,
        needsClarification: true,
        clarificationPrompt: "The current question has already been evaluated. Say 'Next question' or select a new topic to continue.",
        rawTranscript,
      };
    }

    if (context.activeQuestion.kind === "multiple_choice") {
      const choices = context.activeQuestion.choices || [];
      const choiceIndex = letter.charCodeAt(0) - 65;

      if (choiceIndex < 0 || choiceIndex >= choices.length) {
        return {
          intent: "CLARIFY",
          confidence: 0.9,
          needsClarification: true,
          clarificationPrompt: `Option ${letter} is not available for this question. Available choices are A through ${String.fromCharCode(64 + choices.length)}.`,
          rawTranscript,
        };
      }

      return {
        intent: "SELECT_OPTION",
        confidence: 0.98,
        args: {
          optionLetter: letter,
          originalChoiceText: choices[choiceIndex],
        },
        needsClarification: false,
        questionId: context.activeQuestion.questionId,
        rawTranscript,
      };
    }
  }

  // 8. Explicit Submit Answer
  if (/^(?:submit(?:\s+my)?\s+answer|submit)$/i.test(normalized)) {
    if (context.selectedOption) {
      return {
        intent: "SELECT_OPTION",
        confidence: 0.95,
        args: { optionLetter: context.selectedOption as "A" | "B" | "C" | "D" | "E" },
        needsClarification: false,
        questionId: context.activeQuestion?.questionId,
        rawTranscript,
      };
    }
    return {
      intent: "SUBMIT_ANSWER",
      confidence: 0.9,
      args: { answerText: normalized },
      needsClarification: false,
      questionId: context.activeQuestion?.questionId,
      rawTranscript,
    };
  }

  // 9. Start Quiz
  if (/^(?:start(?:\s+a)?\s+quiz|quiz\s+me|test\s+me|let's\s+do\s+a\s+quiz)$/i.test(normalized)) {
    return {
      intent: "START_QUIZ",
      confidence: 0.95,
      needsClarification: false,
      rawTranscript,
    };
  }

  // 10. Study Questions vs Control Commands
  if (
    /^(?:what\s+is|what\s+are|how\s+does|how\s+do|why\s+does|tell\s+me\s+about|define|explain\s+how)\s+([a-z0-9\s-]+)$/i.test(
      normalized,
    )
  ) {
    return {
      intent: "ASK_STUDY_QUESTION",
      confidence: 0.92,
      args: { query: remainingCommand || rawTranscript },
      needsClarification: false,
      rawTranscript,
    };
  }

  // 11. Teach / Quiz specific topic
  const teachMatch = normalized.match(/^(?:teach|explain|tell)\s+(?:me\s+)?(?:about\s+)?([a-z0-9\s-]+)$/i);
  if (teachMatch && teachMatch[1]) {
    const topic = teachMatch[1].trim();
    if (topic && topic !== "that again" && topic !== "more") {
      return {
        intent: "CHANGE_TOPIC",
        confidence: 0.95,
        args: { topic },
        needsClarification: false,
        rawTranscript,
      };
    }
  }

  const quizMatch = normalized.match(/^(?:quiz|test|ask)\s+(?:me\s+)?(?:on|about\s+)?([a-z0-9\s-]+)$/i);
  if (quizMatch && quizMatch[1]) {
    const topic = quizMatch[1].trim();
    if (topic && topic !== "weak concepts") {
      return {
        intent: "CHANGE_TOPIC",
        confidence: 0.95,
        args: { topic, isQuiz: true },
        needsClarification: false,
        rawTranscript,
      };
    }
  }

  // 12. Review weak / full document
  if (/^(?:retest|review|practice|study|test)(?:\s+my)?\s+weak(?:\s+concepts?)?$/i.test(normalized) || /^weak\s+concepts?$/i.test(normalized)) {
    return {
      intent: "CHANGE_TOPIC",
      confidence: 0.95,
      args: { topic: "weak" },
      needsClarification: false,
      rawTranscript,
    };
  }

  if (/^(?:study|review|practice)(?:\s+the)?\s+full\s+document$/i.test(normalized) || /^full\s+document$/i.test(normalized)) {
    return {
      intent: "CHANGE_TOPIC",
      confidence: 0.95,
      args: { topic: "full_document" },
      needsClarification: false,
      rawTranscript,
    };
  }

  // 13. Short answer question fallback
  if (context.activeQuestion?.kind === "short_answer" && !context.isQuestionAnswered) {
    return {
      intent: "SUBMIT_ANSWER",
      confidence: 0.85,
      args: { answerText: remainingCommand || rawTranscript },
      needsClarification: false,
      questionId: context.activeQuestion.questionId,
      rawTranscript,
    };
  }

  // Fallback to study question or clarification
  return {
    intent: "ASK_STUDY_QUESTION",
    confidence: 0.6,
    args: { query: remainingCommand || rawTranscript },
    needsClarification: false,
    rawTranscript,
  };
}

/**
 * Deterministically parse spoken commands into structured voice commands.
 * Maintains backwards compatibility with the VoiceCommand interface.
 */
export function parseVoiceCommand(
  rawTranscript: string,
  context: CommandParserContext = {},
): VoiceCommand {
  const classification = classifyIntent(rawTranscript, context);

  switch (classification.intent) {
    case "STOP_VOICE":
      return { type: "stop_voice" };
    case "PAUSE":
      return { type: "pause" };
    case "RESUME":
      return { type: "resume" };
    case "CHANGE_MODE":
      return { type: "change_mode", mode: classification.args?.mode || "guided" };
    case "NEXT_QUESTION":
      return { type: "next_question" };
    case "PREVIOUS_QUESTION":
      return { type: "previous_question" };
    case "REPEAT_QUESTION":
      return { type: "repeat_question" };
    case "READ_OPTIONS":
      return { type: "read_options" };
    case "EXPLAIN_ANSWER":
      if (classification.args?.target === "why") {
        return { type: "repeat_explanation" };
      }
      return { type: "explain_answer", target: classification.args?.target || "why" };
    case "SIMPLIFY_EXPLANATION":
      return { type: "simplify_explanation" };
    case "REQUEST_EXAMPLE":
      return { type: "request_example" };
    case "REQUEST_HINT":
      return { type: "give_hint" };
    case "START_QUIZ":
      return { type: "start_quiz", topic: classification.args?.topic };
    case "CHANGE_TOPIC": {
      const t = classification.args?.topic;
      if (t === "weak") return { type: "review_weak" };
      if (t === "full_document") return { type: "study_full_document" };
      if (classification.args?.isQuiz) return { type: "quiz_topic", topic: t || "" };
      return { type: "teach_topic", topic: t || "" };
    }
    case "SELECT_OPTION":
      if (classification.args?.optionLetter) {
        return {
          type: "select_option",
          optionLetter: classification.args.optionLetter,
          originalChoiceText: classification.args.originalChoiceText,
          isChange: classification.args.isChange,
        };
      }
      break;
    case "SUBMIT_ANSWER":
      return {
        type: "submit_answer",
        answerText: classification.args?.answerText || rawTranscript,
      };
    case "CLARIFY":
      return {
        type: "ambiguous",
        rawTranscript,
        reason:
          classification.clarificationPrompt ||
          classification.reason ||
          "Could you please clarify your answer?",
      };
    case "ASK_STUDY_QUESTION":
      if (classification.args?.query === "dont_know") {
        return { type: "dont_know" };
      }
      return {
        type: "ask_study_question",
        query: classification.args?.query || rawTranscript,
      };
  }

  return {
    type: "unknown",
    rawTranscript,
  };
}
