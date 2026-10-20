# StudyFlow Voice Tutor & Interaction Architecture Audit

**Date:** 2026-10-20  
**Focus:** Hands-Free Conversational Voice Interaction, Answer-to-Next-Question Lifecycle, State Machine Coordination, Topic Discovery, and Document Adaptation

---

## 1. Executive Summary

This audit assesses the voice and tutoring systems in the Exam Sprint / StudyFlow repository. While prior stabilization resolved note indexing, PDF resolution, and initial voice command parsing, the application still lacks a cohesive, typed state machine governing the answer-to-next-question lifecycle, hands-free conversational flow, and document-adaptive intelligence.

---

## 2. Component-by-Component Trace & Findings

### A. Microphone Activation & Continuous Hands-Free Listening
- **Confirmed Bug / Defect:**
  1. `useVoice` previously lacked coordination between text-to-speech output (`speechSynthesis`) and speech recognition (`SpeechRecognition`), causing audio feedback loops where the tutor's own voice was recognized as learner input.
  2. Stopping voice did not cancel pending progression timers or clear asynchronous speech synthesis callbacks.
  3. When an utterance completed, recognition had an arbitrary restart limit of 5 pauses, leading to premature deactivation during normal study contemplation.
- **Root Cause:** Loosely coordinated boolean flags (`isSpeaking`, `wakeWordEnabled`, `isCommandListening`) without an explicit state machine and cancellation registry.

### B. Voice Command Parsing & Intent Recognition
- **Confirmed Bug / Defect:**
  1. Unhandled Commands: Commands such as `"Next question"`, `"Read the options"`, `"Change my answer to C"`, `"Submit my answer"`, `"Why is that incorrect?"`, `"Explain why B is correct"`, `"Explain this topic more simply"`, `"Give me an example"`, `"Pause"`, and `"Resume"` were either unmapped or treated as generic topic searches, resulting in errors like *"I couldn't find grounded notes for 'next question'"*.
  2. Lack of Progression Commands: Saying `"Next question"` after an evaluation had no dedicated handler and caused a topic search for `"next question"`.
  3. Ambiguity Resolution: Phrases like `"the second one"` or `"the first option"` lacked clarification mechanisms and could either be rejected as unknown or misdirected.
- **Root Cause:** Regex-only command parsing without a typed hybrid intent classifier or clarification protocols.

### C. Answer-to-Next-Question Lifecycle & Progression Modes
- **Confirmed Bug / Defect:**
  1. The app lacked an **Automatic progression mode**. Once an answer was submitted and evaluated, progression required manual button clicking or was stuck if the learner expected hands-free continuation.
  2. In Guided mode, the learner could not advance by saying `"Next question"` because `"next question"` was not routed to the question advancing handler.
  3. State drift occurred between `selectedOption`, `currentQuestion`, `latestEvaluation`, and the voice controller transcript.
- **Root Cause:** Lack of a synchronized question lifecycle manager supporting both **Guided** (wait for learner command) and **Automatic** (countdown and advance) progression modes with visible UI controls.

### D. Tutor Conversation State Machine
- **Confirmed Bug / Defect:**
  1. States like `awaiting_answer`, `evaluating`, `showing_feedback`, and `awaiting_next_action` were implicit boolean combinations (`isLoading && !question`, `Boolean(latestEvaluation)`, etc.).
  2. Race conditions were possible if speech recognition emitted input while an answer was being evaluated by the server.
- **Root Cause:** Absence of a central, typed state machine defining legal transitions (`listening -> recognizing -> processing -> speaking -> awaiting_next_action`).

### E. Topic Discovery & Question Quality Across Documents
- **Confirmed Bug / Defect:**
  1. `ConversationPanel.tsx` featured hardcoded `DEFAULT_TOPIC_SHORTCUTS` containing only DBMS topics (`"Quiz on Normalization"`, `"2NF Practice"`, etc.), causing topic leakage when studying Operating Systems, Computer Networks, or non-CS subjects.
  2. In `document-service.ts`, `DBMS_CONCEPT_TEMPLATES` was checked globally across all documents. Any mention of terms like "deadlock", "primary", or "transaction" in non-DBMS materials (e.g. Operating Systems deadlocks) generated DBMS-specific transaction questions with database distractors.
  3. Fallback distractor generation for non-DBMS materials generated software-engineering-biased distractors rather than document-grounded contrastive statements.
- **Root Cause:** Topic shortcuts and question templates were hardcoded to database normalization instead of being dynamically scoped to the active document's educational domain.

---

## 3. Action Plan & Architecture Roadmap

1. **Explicit Tutor Conversation State Machine (`tutor-state-machine.ts`)**:
   Implement states: `idle`, `listening`, `recognizing`, `processing`, `speaking`, `awaiting_answer`, `evaluating`, `showing_feedback`, `awaiting_next_action`, `error`, `stopped`.
2. **Hybrid Intent Recognition (`voice-command-parser.ts`)**:
   Support all 18 structured intents: `SELECT_OPTION`, `SUBMIT_ANSWER`, `START_QUIZ`, `NEXT_QUESTION`, `PREVIOUS_QUESTION`, `REPEAT_QUESTION`, `READ_OPTIONS`, `EXPLAIN_ANSWER`, `ASK_STUDY_QUESTION`, `REQUEST_HINT`, `REQUEST_EXAMPLE`, `SIMPLIFY_EXPLANATION`, `CHANGE_TOPIC`, `PAUSE`, `RESUME`, `STOP_VOICE`, `CHANGE_MODE`, `CLARIFY`.
3. **Dual Progression Modes in `TutoringSession.tsx`**:
   - Guided mode: Waits for learner voice command (`"Next question"`) or question.
   - Automatic mode: Configurable countdown (e.g., 5 seconds) after tutor explanation completes, with interruption/cancel support.
4. **Domain-Adaptive Question Generation & Elimination of Hardcoded Shortcuts**:
   Derive topics strictly from active documents, eliminate hardcoded DBMS fallbacks in `ConversationPanel`, and generate context-appropriate distractors for OS, Networks, and non-CS subjects.
5. **Comprehensive Test Suite**:
   Automate Scenarios A through J covering command parsing, state transitions, answer progression, and multi-document isolation.
