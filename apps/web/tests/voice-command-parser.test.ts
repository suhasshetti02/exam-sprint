import { describe, expect, it } from "vitest";
import {
  extractWakePhraseAndCommand,
  parseVoiceCommand,
  classifyIntent,
} from "../lib/voice-command-parser";
import type { QuestionData } from "../lib/api-client";

describe("Voice Command Parser", () => {
  const sampleMcq: QuestionData = {
    questionId: "q-1",
    conceptId: "2nf",
    kind: "multiple_choice",
    prompt: "What problem does second normal form remove?",
    choices: [
      "Partial dependencies",
      "Transitive dependencies",
      "Repeating groups",
      "Multi-valued dependencies",
    ],
    evidence: {
      chunkId: "chunk-1",
      quote: "Partial dependencies are removed in 2NF.",
      status: "verified",
    },
  };

  const sampleShortAnswer: QuestionData = {
    questionId: "q-2",
    conceptId: "1nf",
    kind: "short_answer",
    prompt: "What is an atomic attribute?",
    evidence: {
      chunkId: "chunk-2",
      quote: "An attribute is atomic if it cannot be divided.",
      status: "verified",
    },
  };

  describe("extractWakePhraseAndCommand", () => {
    it("recognizes 'Hey Exam Sprint' and extracts remainder", () => {
      const res = extractWakePhraseAndCommand("Hey Exam Sprint, select option A");
      expect(res.hasWakePhrase).toBe(true);
      expect(res.remainingCommand).toBe("select option A");
    });

    it("recognizes 'Exam Sprint' without 'Hey'", () => {
      const res = extractWakePhraseAndCommand("Exam Sprint quiz me on normalization");
      expect(res.hasWakePhrase).toBe(true);
      expect(res.remainingCommand).toBe("quiz me on normalization");
    });

    it("recognizes wake phrase with trailing punctuation", () => {
      const res = extractWakePhraseAndCommand("Hey Exam Sprint! Give me a hint");
      expect(res.hasWakePhrase).toBe(true);
      expect(res.remainingCommand).toBe("Give me a hint");
    });

    it("handles wake phrase alone", () => {
      const res = extractWakePhraseAndCommand("Hey Exam Sprint");
      expect(res.hasWakePhrase).toBe(true);
      expect(res.remainingCommand).toBe("");
    });

    it("returns false when wake phrase is absent", () => {
      const res = extractWakePhraseAndCommand("Select option B");
      expect(res.hasWakePhrase).toBe(false);
      expect(res.remainingCommand).toBe("Select option B");
    });
  });

  it("routes a direct natural question as a question while a short-answer quiz is active", () => {
    const parsed = parseVoiceCommand("What is computer graphics?", {
      activeQuestion: sampleShortAnswer,
    });
    expect(parsed.type).toBe("ask_study_question");
    if (parsed.type === "ask_study_question") {
      expect(parsed.query).toBe("What is computer graphics?");
    }
  });

  it("routes a quick topic overview away from active-answer grading", () => {
    expect(parseVoiceCommand("Can you give me the quick cover of this topic?", {
      activeQuestion: sampleShortAnswer,
    })).toEqual({
      type: "ask_study_question",
      query: "Can you give me the quick cover of this topic?",
    });
  });

  it("routes skip separately from I don't know and supports requested quiz formats", () => {
    expect(parseVoiceCommand("Skip this question", { activeQuestion: sampleShortAnswer })).toEqual({ type: "skip_question" });
    expect(parseVoiceCommand("I don't know", { activeQuestion: sampleShortAnswer })).toEqual({ type: "dont_know" });
    expect(parseVoiceCommand("Quiz me with MCQs", { activeQuestion: sampleShortAnswer })).toEqual({
      type: "start_quiz",
      topic: undefined,
      questionFormat: "multiple_choice",
    });
    expect(parseVoiceCommand("Quiz me with short answer", { activeQuestion: sampleShortAnswer })).toEqual({
      type: "start_quiz",
      topic: undefined,
      questionFormat: "short_answer",
    });
  });

  describe("Study Navigation Commands", () => {
    it("parses 'Teach me 2NF'", () => {
      const res = parseVoiceCommand("Teach me 2NF");
      expect(res).toEqual({ type: "teach_topic", topic: "2nf" });
    });

    it("parses 'Quiz me on normalization'", () => {
      const res = parseVoiceCommand("Quiz me on normalization");
      expect(res).toEqual({ type: "quiz_topic", topic: "normalization" });
    });

    it("parses 'Retest my weak concepts'", () => {
      expect(parseVoiceCommand("Retest my weak concepts")).toEqual({ type: "review_weak" });
      expect(parseVoiceCommand("Review weak")).toEqual({ type: "review_weak" });
    });

    it("parses 'Study the full document'", () => {
      expect(parseVoiceCommand("Study the full document")).toEqual({ type: "study_full_document" });
    });

    it("routes numbered section study requests as topics and preserves decimal titles", () => {
      expect(parseVoiceCommand("Let's study section 12")).toEqual({
        type: "teach_topic",
        topic: "section 12",
      });
      expect(parseVoiceCommand("Study 1.1 The Three I's of Virtual Reality")).toEqual({
        type: "teach_topic",
        topic: "1.1 The Three I's of Virtual Reality",
      });
    });

    it("parses 'Repeat the question'", () => {
      expect(parseVoiceCommand("Repeat the question")).toEqual({ type: "repeat_question" });
      expect(parseVoiceCommand("Read it again")).toEqual({ type: "repeat_question" });
    });

    it("parses 'Explain that again'", () => {
      expect(parseVoiceCommand("Explain that again")).toEqual({ type: "repeat_explanation" });
      expect(parseVoiceCommand("Repeat explanation")).toEqual({ type: "repeat_explanation" });
    });

    it("parses 'Give me a hint'", () => {
      expect(parseVoiceCommand("Give me a hint")).toEqual({ type: "give_hint" });
      expect(parseVoiceCommand("Can I get a hint")).toEqual({ type: "give_hint" });
    });

    it("parses 'I don't know'", () => {
      expect(parseVoiceCommand("I don't know")).toEqual({ type: "dont_know" });
      expect(parseVoiceCommand("Skip this question")).toEqual({ type: "skip_question" });
    });
  });

  describe("Answer Selection Commands", () => {
    it("parses 'Select option A'", () => {
      const res = parseVoiceCommand("Select option A", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "A",
        originalChoiceText: "Partial dependencies",
      });
    });

    it("parses 'Choose B'", () => {
      const res = parseVoiceCommand("Choose B", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "B",
        originalChoiceText: "Transitive dependencies",
      });
    });

    it("parses 'Option C'", () => {
      const res = parseVoiceCommand("Option C", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "C",
        originalChoiceText: "Repeating groups",
      });
    });

    it("parses 'My answer is D'", () => {
      const res = parseVoiceCommand("My answer is D", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "D",
        originalChoiceText: "Multi-valued dependencies",
      });
    });

    it("parses 'Submit answer A'", () => {
      const res = parseVoiceCommand("Submit answer A", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "A",
        originalChoiceText: "Partial dependencies",
      });
    });

    it("handles wake phrase combined with answer selection", () => {
      const res = parseVoiceCommand("Hey Exam Sprint, choose B", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "B",
        originalChoiceText: "Transitive dependencies",
      });
    });

    it("rejects option selection if no question is active", () => {
      const res = parseVoiceCommand("Select option A");
      expect(res.type).toBe("ambiguous");
      if (res.type === "ambiguous") {
        expect(res.reason).toMatch(/no active question/i);
      }
    });

    it("rejects option selection if question has already been answered", () => {
      const res = parseVoiceCommand("Select option A", {
        activeQuestion: sampleMcq,
        isQuestionAnswered: true,
      });
      expect(res.type).toBe("ambiguous");
      if (res.type === "ambiguous") {
        expect(res.reason).toMatch(/already been evaluated/i);
      }
    });

    it("rejects option out of range (e.g. Option E when only A-D exist)", () => {
      const res = parseVoiceCommand("Select option E", { activeQuestion: sampleMcq });
      expect(res.type).toBe("ambiguous");
      if (res.type === "ambiguous") {
        expect(res.reason).toMatch(/Option E is not available/i);
      }
    });

    it("flags ambiguous conflicting choices e.g. 'Select A or B'", () => {
      const res = parseVoiceCommand("Select A or B", { activeQuestion: sampleMcq });
      expect(res.type).toBe("ambiguous");
      if (res.type === "ambiguous") {
        expect(res.reason).toMatch(/Multiple conflicting choices/i);
      }
    });

    it("parses 'Lock in A'", () => {
      const res = parseVoiceCommand("Lock in A", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "A",
        originalChoiceText: "Partial dependencies",
      });
    });

    it("parses 'I choose option A'", () => {
      const res = parseVoiceCommand("I choose option A", { activeQuestion: sampleMcq });
      expect(res).toEqual({
        type: "select_option",
        optionLetter: "A",
        originalChoiceText: "Partial dependencies",
      });
    });

    it("never interprets arbitrary words after option as answer labels", () => {
      for (const transcript of ["Option study", "Option section 12", "I choose study", "study"]) {
        const parsed = parseVoiceCommand(transcript, { activeQuestion: sampleMcq });
        expect(parsed.type).toBe("ask_study_question");
        expect(parsed.type).not.toBe("select_option");
        expect(parsed.type).not.toBe("submit_answer");
      }
    });

    it("normalizes speech recognition phonetic letter variants like 'Option ay' and 'Option bee'", () => {
      expect(parseVoiceCommand("Option ay", { activeQuestion: sampleMcq })).toEqual({
        type: "select_option",
        optionLetter: "A",
        originalChoiceText: "Partial dependencies",
      });

      expect(parseVoiceCommand("Option bee", { activeQuestion: sampleMcq })).toEqual({
        type: "select_option",
        optionLetter: "B",
        originalChoiceText: "Transitive dependencies",
      });

      expect(parseVoiceCommand("Choose option see", { activeQuestion: sampleMcq })).toEqual({
        type: "select_option",
        optionLetter: "C",
        originalChoiceText: "Repeating groups",
      });

      expect(parseVoiceCommand("Lock in option dee", { activeQuestion: sampleMcq })).toEqual({
        type: "select_option",
        optionLetter: "D",
        originalChoiceText: "Multi-valued dependencies",
      });
    });

    it("parses 'Stop voice' command", () => {
      expect(parseVoiceCommand("Stop voice")).toEqual({ type: "stop_voice" });
      expect(parseVoiceCommand("Stop listening")).toEqual({ type: "stop_voice" });
      expect(parseVoiceCommand("Turn off voice")).toEqual({ type: "stop_voice" });
    });

    it("submits spoken answer for short-answer questions", () => {
      const res = parseVoiceCommand("it cannot be divided further", {
        activeQuestion: sampleShortAnswer,
      });
      expect(res).toEqual({
        type: "submit_answer",
        answerText: "it cannot be divided further",
      });
    });
  });

  describe("Hybrid Intent Recognition & Conversational Commands", () => {
    it("classifies NEXT_QUESTION for 'Next question', 'continue', and 'advance'", () => {
      expect(classifyIntent("Next question").intent).toBe("NEXT_QUESTION");
      expect(classifyIntent("continue").intent).toBe("NEXT_QUESTION");
      expect(classifyIntent("advance").intent).toBe("NEXT_QUESTION");
      expect(classifyIntent("next one").intent).toBe("NEXT_QUESTION");
      expect(parseVoiceCommand("Next question")).toEqual({ type: "next_question" });
    });

    it("classifies READ_OPTIONS for 'Read the options' and 'What are the choices'", () => {
      expect(classifyIntent("Read the options").intent).toBe("READ_OPTIONS");
      expect(classifyIntent("What are the choices").intent).toBe("READ_OPTIONS");
      expect(parseVoiceCommand("Read the options")).toEqual({ type: "read_options" });
    });

    it("classifies EXPLAIN_ANSWER for 'Why was my answer wrong' and 'Why is B correct'", () => {
      const wrong = classifyIntent("Why was my answer wrong");
      expect(wrong.intent).toBe("EXPLAIN_ANSWER");
      expect(wrong.args?.target).toBe("why_wrong");

      const correct = classifyIntent("Why is B correct");
      expect(correct.intent).toBe("EXPLAIN_ANSWER");
      expect(correct.args?.target).toBe("why_correct");
      expect(correct.args?.optionLetter).toBe("B");
    });

    it("classifies SIMPLIFY_EXPLANATION for 'Explain this topic more simply'", () => {
      expect(classifyIntent("Explain this topic more simply").intent).toBe("SIMPLIFY_EXPLANATION");
      expect(classifyIntent("in simple terms").intent).toBe("SIMPLIFY_EXPLANATION");
      expect(parseVoiceCommand("Explain this topic more simply")).toEqual({ type: "simplify_explanation" });
    });

    it("classifies REQUEST_EXAMPLE for 'Give me an example'", () => {
      expect(classifyIntent("Give me an example").intent).toBe("REQUEST_EXAMPLE");
      expect(classifyIntent("can you give an example").intent).toBe("REQUEST_EXAMPLE");
      expect(parseVoiceCommand("Give me an example")).toEqual({ type: "request_example" });
    });

    it("classifies CHANGE_MODE for automatic and guided mode switches", () => {
      const auto = classifyIntent("Switch to auto advance");
      expect(auto.intent).toBe("CHANGE_MODE");
      expect(auto.args?.mode).toBe("automatic");

      const guided = classifyIntent("Guided mode");
      expect(guided.intent).toBe("CHANGE_MODE");
      expect(guided.args?.mode).toBe("guided");
    });

    it("classifies PAUSE and RESUME", () => {
      expect(classifyIntent("Pause").intent).toBe("PAUSE");
      expect(classifyIntent("Resume").intent).toBe("RESUME");
      expect(parseVoiceCommand("Pause")).toEqual({ type: "pause" });
      expect(parseVoiceCommand("Resume")).toEqual({ type: "resume" });
    });

    it("classifies ASK_STUDY_QUESTION for 'What is a database index?' and does NOT select an option", () => {
      const res = classifyIntent("What is a database index?", { activeQuestion: sampleMcq });
      expect(res.intent).toBe("ASK_STUDY_QUESTION");
      expect(res.args?.query).toMatch(/What is a database index/i);

      const parsed = parseVoiceCommand("What is a database index?", { activeQuestion: sampleMcq });
      expect(parsed.type).toBe("ask_study_question");
      if (parsed.type === "ask_study_question") {
        expect(parsed.query).toMatch(/What is a database index/i);
      }
    });

    it("handles 'Change my answer to C' before evaluation", () => {
      const res = classifyIntent("Change my answer to C", {
        activeQuestion: sampleMcq,
        isQuestionAnswered: false,
      });
      expect(res.intent).toBe("SELECT_OPTION");
      expect(res.args?.optionLetter).toBe("C");
      expect(res.args?.isChange).toBe(true);

      const parsed = parseVoiceCommand("Change my answer to C", {
        activeQuestion: sampleMcq,
        isQuestionAnswered: false,
      });
      expect(parsed).toEqual({
        type: "select_option",
        optionLetter: "C",
        isChange: true,
      });
    });

    it("clarifies ordinal phrases like 'the second one' instead of guessing", () => {
      const res = classifyIntent("I think the second one", { activeQuestion: sampleMcq });
      expect(res.intent).toBe("CLARIFY");
      expect(res.needsClarification).toBe(true);
      expect(res.clarificationPrompt).toMatch(/Did you mean option B/i);

      const parsed = parseVoiceCommand("the second one", { activeQuestion: sampleMcq });
      expect(parsed.type).toBe("ambiguous");
      if (parsed.type === "ambiguous") {
        expect(parsed.reason).toMatch(/Did you mean option B/i);
      }
    });
  });
});
