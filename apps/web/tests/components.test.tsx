import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationPanel } from "../components/ConversationPanel";
import { IMPLEMENTATION_STATUS, StatusChecklist } from "../components/StatusChecklist";
import { ServerStatus } from "../components/ServerStatus";
import { QuizCard } from "../components/QuizCard";
import { EvidenceCard } from "../components/EvidenceCard";
import { MasteryPanel } from "../components/MasteryPanel";
import { RapidFireChallenge } from "../components/RapidFireChallenge";
import { SetupScreen } from "../components/SetupScreen";
import type { EvidenceData, QuestionData, ToolTraceEntry, ChallengeState } from "../lib/api-client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConversationPanel", () => {
  it("keeps microphone disabled with clear voice-off label", () => {
    render(<ConversationPanel />);
    expect((screen.getByLabelText(/microphone/i) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Voice off/i)).toBeTruthy();
  });

  it("allows user to type and submit a message", () => {
    const handleSend = vi.fn();
    render(<ConversationPanel onSendMessage={handleSend} />);

    const input = screen.getByLabelText(/message the tutor/i) as HTMLInputElement;
    expect(input.disabled).toBe(false);

    fireEvent.change(input, { target: { value: "Quiz me on 2NF" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(handleSend).toHaveBeenCalledWith("Quiz me on 2NF");
  });

  it("triggers topic chips on click", () => {
    const handleTopic = vi.fn();
    render(<ConversationPanel onStartTopic={handleTopic} />);

    fireEvent.click(screen.getByRole("button", { name: /quiz on normalization/i }));
    expect(handleTopic).toHaveBeenCalledWith("normalization");
  });
});

describe("QuizCard", () => {
  const sampleQuestion: QuestionData = {
    questionId: "q-2nf-1",
    conceptId: "2nf",
    kind: "multiple_choice",
    prompt: "What problem does second normal form remove?",
    choices: ["A. Partial dependencies", "B. Transitive dependencies"],
    evidence: {
      chunkId: "dbms-normalization#second-normal-form",
      quote: "Partial dependencies are the problem this form removes.",
      status: "verified",
      start: 10,
      end: 55,
    },
  };

  it("renders empty state when no active question exists", () => {
    render(<QuizCard />);
    expect(screen.getByText("No question yet")).toBeTruthy();
  });

  it("renders question prompt and choices when question is active", () => {
    render(<QuizCard question={sampleQuestion} />);
    expect(screen.getByText("What problem does second normal form remove?")).toBeTruthy();
    expect(screen.getByText(/Partial dependencies/)).toBeTruthy();
  });

  it("shows verdict and diagnosed misconception when evaluated", () => {
    render(
      <QuizCard
        question={sampleQuestion}
        evaluation={{
          verdict: "incorrect",
          explanation: "Transitive dependencies are removed by 3NF.",
          misconceptionLabel: "confuses-2nf-with-3nf",
        }}
      />,
    );

    expect(screen.getByText(/Incorrect/)).toBeTruthy();
    expect(screen.getByText(/Transitive dependencies are removed by 3NF/)).toBeTruthy();
    expect(screen.getByText(/confuses-2nf-with-3nf/)).toBeTruthy();
  });

  it("shows loading state when isLoading is true and no question is present", () => {
    render(<QuizCard isLoading={true} question={undefined} />);
    expect(screen.getByText(/Loading question grounded in notes/i)).toBeTruthy();
  });

  it("resets typed answer when question changes", () => {
    const shortQ1: QuestionData = {
      questionId: "q-1",
      conceptId: "1nf",
      kind: "short_answer",
      prompt: "Prompt 1",
      evidence: { chunkId: "c1", quote: "q1", status: "verified" },
    };
    const shortQ2: QuestionData = {
      questionId: "q-2",
      conceptId: "2nf",
      kind: "short_answer",
      prompt: "Prompt 2",
      evidence: { chunkId: "c2", quote: "q2", status: "verified" },
    };

    const { rerender } = render(<QuizCard question={shortQ1} />);
    const input = screen.getByLabelText(/your answer/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "My old answer" } });
    expect(input.value).toBe("My old answer");

    // Switching question must clear the input to prevent stale answer submission
    rerender(<QuizCard question={shortQ2} />);
    const updatedInput = screen.getByLabelText(/your answer/i) as HTMLInputElement;
    expect(updatedInput.value).toBe("");
  });
});

describe("EvidenceCard", () => {
  it("renders empty state when no evidence quotation is available", () => {
    render(<EvidenceCard />);
    expect(screen.getByText(/No evidence quotation yet/i)).toBeTruthy();
  });

  it("displays verified quote with character offsets and verified badge", () => {
    const verifiedEvidence: EvidenceData = {
      chunkId: "dbms-normalization#second-normal-form",
      quote: "Partial dependencies are the problem this form removes.",
      status: "verified",
      start: 140,
      end: 195,
    };

    render(<EvidenceCard evidence={verifiedEvidence} />);
    expect(screen.getByText(/Partial dependencies are the problem this form removes./)).toBeTruthy();
    expect(screen.getByText(/dbms-normalization#second-normal-form/)).toBeTruthy();
    expect(screen.getByText(/Offsets: chars 140–195/)).toBeTruthy();
    expect(screen.getByText("Verified quote")).toBeTruthy();
  });

  it("shows rejection alert if quotation is unverified or rejected", () => {
    const rejectedEvidence: EvidenceData = {
      chunkId: "dbms-normalization#second-normal-form",
      quote: "An unverified hallucinated quote.",
      status: "rejected",
    };

    render(<EvidenceCard evidence={rejectedEvidence} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Quotation Rejected/i)).toBeTruthy();
  });
});

describe("MasteryPanel", () => {
  it("displays concept mastery bars and flags weak concepts", () => {
    const sampleMastery = [
      {
        conceptId: "2nf",
        mastery: 0.25,
        attemptsCount: 2,
        openMisconceptions: ["confuses-2nf-with-3nf"],
      },
      {
        conceptId: "acid",
        mastery: 0.8,
        attemptsCount: 4,
        openMisconceptions: [],
      },
    ];

    render(<MasteryPanel masteryList={sampleMastery} onReviewWeak={vi.fn()} />);
    expect(screen.getByText("2nf")).toBeTruthy();
    expect(screen.getByText("25%")).toBeTruthy();
    expect(screen.getByText("⚠ confuses-2nf-with-3nf")).toBeTruthy();
    expect(screen.getByText("acid")).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText(/You have concepts flagged for review/i)).toBeTruthy();
  });
});

describe("ServerStatus", () => {
  it("shows an error when the status request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<ServerStatus />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("network down"));
  });

  it("lists tools reported by the server and shows tool trace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          reachable: true,
          serverName: "exam-sprint",
          serverVersion: "0.1.0",
          tools: [{ name: "generate_quiz", description: "", status: "implemented" }],
        }),
      }),
    );

    const sampleTraces: ToolTraceEntry[] = [
      {
        tool: "generate_quiz",
        arguments: { conceptId: "2nf", count: 1 },
        status: "success",
        durationMs: 42,
        timestamp: "2026-10-17T20:00:00.000Z",
      },
    ];

    render(<ServerStatus toolTraces={sampleTraces} />);
    await waitFor(() => expect(screen.getAllByText("generate_quiz").length).toBeGreaterThan(0));
    expect(screen.getByText("Implemented")).toBeTruthy();
    expect(screen.getByText("42ms")).toBeTruthy();
    expect(screen.getByText("success")).toBeTruthy();
  });
});

describe("StatusChecklist", () => {
  it("reflects implementation progress accurately", () => {
    render(<StatusChecklist />);
    const doneItems = IMPLEMENTATION_STATUS.filter((i) => i.done).map((i) => i.label);
    expect(doneItems).toContain("Note retrieval and evidence verification");
    expect(doneItems).toContain("Quiz generation and answer evaluation");
    expect(doneItems).toContain("Progress and mastery persistence");
    expect(doneItems).toContain("LLM agent loop and deterministic fallback");
    expect(doneItems).toContain("Rapid-Fire Redemption weak-concept sprint");

    const pendingItems = IMPLEMENTATION_STATUS.filter((i) => !i.done).map((i) => i.label);
    expect(pendingItems).toContain("Voice input/output (Web Speech API)");
  });
});

describe("Rapid-Fire Redemption UI Integration", () => {
  it("ConversationPanel renders Rapid-Fire Redemption sprint banner and handles click", () => {
    const handleStartChallenge = vi.fn();
    render(<ConversationPanel onStartChallenge={handleStartChallenge} />);

    const startBtn = screen.getByRole("button", { name: /start sprint/i });
    expect(startBtn).toBeTruthy();
    fireEvent.click(startBtn);
    expect(handleStartChallenge).toHaveBeenCalledOnce();
  });

  it("MasteryPanel renders Rapid-Fire button when weak concepts exist", () => {
    const handleStartChallenge = vi.fn();
    render(
      <MasteryPanel
        masteryList={[
          {
            conceptId: "2nf",
            mastery: 0.2,
            attemptsCount: 3,
            openMisconceptions: ["confuses-2nf-with-3nf"],
          },
        ]}
        onStartChallenge={handleStartChallenge}
      />,
    );

    const rfBtn = screen.getByRole("button", { name: /rapid-fire/i });
    expect(rfBtn).toBeTruthy();
    fireEvent.click(rfBtn);
    expect(handleStartChallenge).toHaveBeenCalledOnce();
  });

  it("RapidFireChallenge does not render when isOpen is false", () => {
    const { container } = render(
      <RapidFireChallenge isOpen={false} onClose={vi.fn()} masteryList={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("RapidFireChallenge renders dialog and loading state when open", async () => {
    const mockChallenge: ChallengeState = {
      challengeId: "chal_mock1",
      status: "active",
      score: 0,
      totalSlots: 5,
      startedAt: new Date().toISOString(),
      slots: [
        {
          slotIndex: 0,
          questionId: "q_1",
          conceptId: "2nf",
          question: {
            prompt: "What is 2NF?",
            kind: "multiple_choice",
            choices: ["A. First choice", "B. Second choice"],
            evidence: {
              chunkId: "c1",
              quote: "A relation is in 2NF...",
              status: "verified",
            },
          },
          answered: false,
        },
      ],
      toolTraces: [],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockChallenge,
      }),
    );

    render(<RapidFireChallenge isOpen={true} onClose={vi.fn()} masteryList={[]} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Rapid-Fire Redemption/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("What is 2NF?")).toBeTruthy();
      expect(screen.getByText(/Target: 2nf/i)).toBeTruthy();
      expect(screen.getByText("Slot 1 of 5")).toBeTruthy();
    });
  });
});

describe("SetupScreen", () => {
  it("resolves library loading and triggers onStartSession on click", async () => {
    const mockDocs = [
      {
        id: "dbms-notes",
        title: "DBMS Notes",
        origin: "sample",
        chunkCount: 9,
        conceptCount: 8,
        createdAt: new Date().toISOString(),
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ documents: mockDocs }),
      }),
    );

    const handleStart = vi.fn();
    render(<SetupScreen onStartSession={handleStart} />);

    // Initially shows loading or resolves to document
    await waitFor(() => {
      expect(screen.getAllByText("DBMS Notes").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("9 chunks")).toBeTruthy();
    });

    // Change goal
    const quizGoal = screen.getByText("Quiz me on a topic");
    fireEvent.click(quizGoal);

    // Click Start Learning
    const startBtn = screen.getByRole("button", { name: /start learning/i });
    fireEvent.click(startBtn);

    expect(handleStart).toHaveBeenCalledWith({
      documentId: "dbms-notes",
      documentTitle: "DBMS Notes",
      goal: "quiz",
      topic: undefined,
    });
  });

  it("handles failed library request and allows retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Network connection failed")),
    );

    render(<SetupScreen onStartSession={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Could not load library documents/i)).toBeTruthy();
      expect(screen.getByRole("button", { name: /retry loading/i })).toBeTruthy();
    });
  });
});

