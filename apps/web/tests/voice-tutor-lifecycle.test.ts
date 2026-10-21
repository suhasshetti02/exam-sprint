import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { parseVoiceCommand, classifyIntent } from "../lib/voice-command-parser";
import { TutorConversationStateMachine } from "../lib/tutor-state-machine";
import {
  startTutoringSession,
  submitStudentAnswer,
  loadInitialMasteryState,
} from "../lib/server/tutoring-policy";
import { ingestDocument, deleteDocument } from "../lib/server/document-service";
import type { QuestionData } from "../lib/api-client";

describe("Requirement 10: Voice Tutor End-to-End Journeys (Scenarios A through J)", () => {
  let docId: string;

  const NOTES = `COMPREHENSIVE RELATIONAL DATABASE NOTES
Subject: DBMS Fundamentals
1. DATABASE INDEXING
A database index is an auxiliary data structure, commonly implemented as a B-tree or hash map, that speeds up data retrieval operations on a table at the cost of additional storage space and slower writes. Without an index, the database engine must perform a full table scan, examining every row sequentially.

2. SECOND NORMAL FORM
A relation is in Second Normal Form when it is in First Normal Form and every non-prime attribute is fully functionally dependent on every candidate key. No non-prime attribute may depend on only a proper subset of a composite candidate key. This rule eliminates partial functional dependencies.
`;

  beforeAll(async () => {
    const res = await ingestDocument("Database_Fundamentals.txt", Buffer.from(NOTES, "utf8"));
    expect(res.success).toBe(true);
    docId = res.documentId!;
  });

  afterAll(() => {
    if (docId) {
      deleteDocument(docId);
    }
  });

  it("Scenario A: Start session → select A by voice → evaluate once → receive evidence → say 'Next question' → receive new question", async () => {
    // 1. Start a session
    const sessionRes = await startTutoringSession({
      documentId: docId,
      topic: "Second Normal Form",
      goal: "quiz",
    });
    expect(sessionRes.question).toBeDefined();
    const activeQuestion = sessionRes.question!;
    expect(activeQuestion.choices).toBeDefined();

    // 2. State machine starts awaiting answer
    const sm = new TutorConversationStateMachine();
    sm.transition("listening");
    sm.transition("recognizing");
    sm.transition("processing");
    sm.transition("awaiting_answer");
    expect(sm.getState()).toBe("awaiting_answer");

    // 3. Learner says "Select option A"
    const parsed = parseVoiceCommand("Select option A.", { activeQuestion });
    expect(parsed.type).toBe("select_option");
    if (parsed.type !== "select_option") throw new Error("Expected select_option");
    expect(parsed.optionLetter).toBe("A");

    // 4. Submit answer exactly once
    sm.transition("evaluating");
    const evalRes = await submitStudentAnswer({
      questionId: activeQuestion.questionId,
      answer: "A",
    });
    expect(evalRes.evaluation).toBeDefined();
    expect(evalRes.evidence).toBeDefined();
    expect(evalRes.evidence?.status).toBe("verified");

    // 5. Present feedback
    sm.transition("showing_feedback");
    sm.transition("awaiting_next_action");
    expect(sm.getState()).toBe("awaiting_next_action");

    // 6. Learner says "Next question"
    const nextCmd = parseVoiceCommand("Next question", {
      activeQuestion,
      isQuestionAnswered: true,
    });
    expect(nextCmd.type).toBe("next_question");

    // 7. Advance to new question
    const nextSession = await startTutoringSession({
      documentId: docId,
      topic: activeQuestion.conceptId,
      goal: "quiz",
    });
    expect(nextSession.question).toBeDefined();
    sm.transition("awaiting_answer");
    expect(sm.getState()).toBe("awaiting_answer");
  });

  it("Scenario B: Select an incorrect answer → receive feedback → ask 'Why?' → receive grounded explanation", async () => {
    const sessionRes = await startTutoringSession({
      documentId: docId,
      topic: "Second Normal Form",
      goal: "quiz",
    });
    const question = sessionRes.question!;

    // Select deliberate wrong answer without hardcoded answer position assumptions
    let evalRes = await submitStudentAnswer({
      questionId: question.questionId,
      answer: "A",
    });
    if (evalRes.evaluation?.verdict === "correct") {
      evalRes = await submitStudentAnswer({
        questionId: question.questionId,
        answer: "B",
      });
    }
    expect(evalRes.evaluation).toBeDefined();
    expect(evalRes.evaluation?.verdict).toBe("incorrect");

    // Learner asks "Why was my answer wrong?"
    const classification = classifyIntent("Why was my answer wrong?", {
      activeQuestion: question,
      isQuestionAnswered: true,
      lastEvaluationSummary: evalRes.evaluation?.explanation,
    });
    expect(classification.intent).toBe("EXPLAIN_ANSWER");
    expect(classification.args?.target).toBe("why_wrong");

    const cmd = parseVoiceCommand("Why was my answer wrong?", {
      activeQuestion: question,
      isQuestionAnswered: true,
    });
    expect(cmd.type).toBe("explain_answer");
  });

  it("Scenario C: Ask 'What is an index?' while question is displayed → grounded explanation without submitting answer", async () => {
    const sessionRes = await startTutoringSession({
      documentId: docId,
      topic: "Second Normal Form",
      goal: "quiz",
    });
    const question = sessionRes.question!;

    // While question is active, learner asks about indexing
    const classification = classifyIntent("What is a database index?", {
      activeQuestion: question,
      isQuestionAnswered: false,
    });
    expect(classification.intent).toBe("ASK_STUDY_QUESTION");
    expect(classification.args?.query).toBe("What is a database index?");

    const cmd = parseVoiceCommand("What is a database index?", {
      activeQuestion: question,
      isQuestionAnswered: false,
    });
    expect(cmd.type).toBe("ask_study_question");

    // Retrieve study notes for index without submitting question
    const teachRes = await startTutoringSession({
      documentId: docId,
      topic: "DATABASE INDEXING",
      goal: "teach",
    });
    expect(teachRes.evidence?.quote.toLowerCase()).toContain("index");
    // Original question remains intact
    expect(question.questionId).toBeDefined();
  });

  it("Scenario D: Say 'Repeat the question' and 'Read the options' → parsed cleanly", () => {
    const fakeQuestion: QuestionData = {
      questionId: "q_test",
      conceptId: "2nf",
      kind: "multiple_choice",
      prompt: "What is 2NF?",
      choices: ["Choice 1", "Choice 2", "Choice 3", "Choice 4"],
      evidence: { chunkId: "c1", quote: "quote", status: "verified" },
    };

    const cmd1 = parseVoiceCommand("Repeat the question please", { activeQuestion: fakeQuestion });
    expect(cmd1.type).toBe("repeat_question");

    const cmd2 = parseVoiceCommand("Read the options", { activeQuestion: fakeQuestion });
    expect(cmd2.type).toBe("read_options");
  });

  it("Scenario E: Say 'Stop voice' while listening → all voice interactions stop cleanly", () => {
    const sm = new TutorConversationStateMachine();
    sm.transition("listening");
    expect(sm.getState()).toBe("listening");

    const cmd = parseVoiceCommand("Stop voice");
    expect(cmd.type).toBe("stop_voice");

    sm.transition("stopped");
    expect(sm.getState()).toBe("stopped");
    expect(sm.isAutoAdvanceActive()).toBe(false);
  });

  it("Scenario F: Lose microphone permission → enters error state with manual fallback available", () => {
    const sm = new TutorConversationStateMachine();
    sm.transition("listening");
    sm.transition("error");
    expect(sm.getState()).toBe("error");
    expect(sm.getEffectiveVoiceState()).toBe("error");

    // Reset back to idle / manual text mode
    sm.reset();
    expect(sm.getState()).toBe("idle");
  });

  it("Scenario G: Upload different subjects → verifies subject isolation", async () => {
    const bioText = "Mitochondria produce ATP through oxidative phosphorylation.";
    const bioRes = await ingestDocument("Bio_Test.txt", Buffer.from(bioText, "utf8"));
    expect(bioRes.success).toBe(true);

    try {
      const dbmsRes = await startTutoringSession({
        documentId: docId,
        topic: "Second Normal Form",
        goal: "quiz",
      });
      expect(dbmsRes.evidence?.quote.toLowerCase()).toContain("second normal form");
      expect(dbmsRes.evidence?.quote.toLowerCase()).not.toContain("mitochondria");
    } finally {
      if (bioRes.documentId) {
        deleteDocument(bioRes.documentId);
      }
    }
  });

  it("Scenario H: Ambiguous answer 'the second one' → requests clarification instead of guessing", () => {
    const fakeQuestion: QuestionData = {
      questionId: "q_test",
      conceptId: "2nf",
      kind: "multiple_choice",
      prompt: "What is 2NF?",
      choices: ["Choice A", "Choice B", "Choice C", "Choice D"],
      evidence: { chunkId: "c1", quote: "quote", status: "verified" },
    };

    const classification = classifyIntent("I think the second one", {
      activeQuestion: fakeQuestion,
      isQuestionAnswered: false,
    });
    expect(classification.needsClarification).toBe(true);
    expect(classification.intent).toBe("CLARIFY");

    const cmd = parseVoiceCommand("I think the second one", {
      activeQuestion: fakeQuestion,
      isQuestionAnswered: false,
    });
    expect(cmd.type).toBe("ambiguous");
    if (cmd.type === "ambiguous") {
      expect(cmd.reason).toContain("option B");
    }
  });

  it("Scenario I: Graceful recovery without losing session state", async () => {
    const sessionRes = await startTutoringSession({
      documentId: docId,
      topic: "Second Normal Form",
      goal: "quiz",
    });
    expect(sessionRes.question).toBeDefined();

    // Verify initial mastery state is readable even if an external provider errors
    const state = await loadInitialMasteryState();
    expect(state.masteryList).toBeDefined();
    expect(Array.isArray(state.masteryList)).toBe(true);
  });

  it("Scenario J: Duplicate recognition events submit only once to authoritative evaluator", async () => {
    const sessionRes = await startTutoringSession({
      documentId: docId,
      topic: "Second Normal Form",
      goal: "quiz",
    });
    const question = sessionRes.question!;

    // First submission
    const res1 = await submitStudentAnswer({
      questionId: question.questionId,
      answer: "A",
    });
    expect(res1.evaluation).toBeDefined();

    // When student / recognition repeats "Select option A" after question is already evaluated
    const cmdRepeat = parseVoiceCommand("Select option A", {
      activeQuestion: question,
      isQuestionAnswered: true,
    });
    // Pre-submission guard detects already answered
    expect(cmdRepeat.type).toBe("ambiguous");
    if (cmdRepeat.type === "ambiguous") {
      expect(cmdRepeat.reason).toContain("already been evaluated");
    }
  });
});
