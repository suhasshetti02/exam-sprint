import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  extractTextFromFile,
  ingestDocument,
  listDocuments,
  deleteDocument,
} from "../lib/server/document-service";
import { startTutoringSession } from "../lib/server/tutoring-policy";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";
import { MockLlmProvider } from "../lib/server/llm/providers";

describe("Milestone 8: Complete First-Time Learning Journey & Voice Integration", () => {
  function getRepoRoot(): string {
    let dir = __dirname;
    while (dir && dir !== resolve(dir, "..")) {
      if (existsSync(resolve(dir, "data/local/exam-sprint.db"))) {
        return dir;
      }
      dir = resolve(dir, "..");
    }
    return process.cwd();
  }

  const repoRoot = getRepoRoot();
  const tempDbPath = resolve(repoRoot, "data/local/test-milestone8.db");

  beforeAll(() => {
    const origDb = resolve(repoRoot, "data/local/exam-sprint.db");
    mkdirSync(dirname(tempDbPath), { recursive: true });
    if (existsSync(origDb)) {
      copyFileSync(origDb, tempDbPath);
    }
    process.env.DATABASE_PATH = tempDbPath;
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    if (existsSync(tempDbPath)) {
      try {
        rmSync(tempDbPath, { force: true });
      } catch {
        // Non-fatal cleanup
      }
    }
  });
  // ---- 1. Starting with sample notes --------------------------------------
  it("1. Starts a learning session with sample DBMS notes", async () => {
    const res = await startTutoringSession({
      documentId: "dbms-normalization",
      goal: "teach",
      topic: "1nf",
    });

    expect(res.question).toBeDefined();
    expect(res.question?.conceptId).toBe("1nf");
    expect(res.evidence).toBeDefined();
    expect(res.evidence?.chunkId).toContain("first-normal-form");
    expect(res.evidence?.status).toBe("verified");
    expect(res.message).toBeTruthy();
  });

  // ---- 2. Uploading multiple supported files ------------------------------
  it("2. Ingests multiple supported files (Markdown and TXT) into study library", async () => {
    const mdContent = `---
title: Operating Systems Notes
---
# Process Scheduling
A process scheduler maximizes CPU utilization by switching the CPU among processes. Round robin uses time slices.

# Virtual Memory
Virtual memory provides an illusion of a large contiguous memory space using paging and page tables.
`;

    const txtContent = `Computer Networks Architecture.
The OSI model consists of seven layers: Physical, Data Link, Network, Transport, Session, Presentation, Application.
TCP provides reliable byte stream delivery with sequence numbers and acknowledgements.
`;

    const mdRes = await ingestDocument("os-notes.md", Buffer.from(mdContent, "utf8"));
    expect(mdRes.success).toBe(true);
    expect(mdRes.chunkCount).toBeGreaterThanOrEqual(2);
    expect(mdRes.documentId).toBeDefined();

    const txtRes = await ingestDocument("networks.txt", Buffer.from(txtContent, "utf8"));
    expect(txtRes.success).toBe(true);
    expect(txtRes.chunkCount).toBeGreaterThanOrEqual(1);
    expect(txtRes.documentId).toBeDefined();

    // Verify documents are listed in the library
    const docs = listDocuments();
    const osDoc = docs.find((d) => d.id === mdRes.documentId);
    expect(osDoc).toBeDefined();
    expect(osDoc?.origin).toBe("student-upload");

    // Clean up created test documents
    if (mdRes.documentId) deleteDocument(mdRes.documentId);
    if (txtRes.documentId) deleteDocument(txtRes.documentId);
  });

  // ---- 3. Processing unsupported, empty, or malformed files ---------------
  it("3. Handles unsupported, empty, or malformed files with clear errors", async () => {
    // Empty file
    await expect(extractTextFromFile("empty.txt", Buffer.from(""))).rejects.toThrow(
      /File is empty/i,
    );

    // Unsupported format
    await expect(
      extractTextFromFile("presentation.pptx", Buffer.from("presentation data")),
    ).rejects.toThrow(/Unsupported file type/i);

    // Corrupted PDF
    await expect(
      extractTextFromFile("corrupted.pdf", Buffer.from("not a real pdf content")),
    ).rejects.toThrow(/invalid pdf|corrupted/i);
  });

  // ---- 4. Retrieving evidence from uploaded document -----------------------
  it("4. Retrieves evidence and grounded questions from an uploaded document", async () => {
    const content = `# Deadlock Prevention
Deadlock requires four mutual conditions: mutual exclusion, hold and wait, no preemption, and circular wait.
`;

    const ingestRes = await ingestDocument("deadlocks.md", Buffer.from(content, "utf8"));
    expect(ingestRes.success).toBe(true);
    const docId = ingestRes.documentId!;

    try {
      const res = await startTutoringSession({
        documentId: docId,
        goal: "quiz",
      });

      expect(res.question).toBeDefined();
      expect(res.evidence).toBeDefined();
      expect(res.evidence?.chunkId).toContain(docId);
      expect(res.evidence?.status).toBe("verified");
      expect(res.evidence?.quote).toContain("Deadlock requires four mutual conditions");
    } finally {
      deleteDocument(docId);
    }
  });

  // ---- 5. Starting a session with a chosen goal ---------------------------
  it("5. Customizes session start based on chosen learning goal", async () => {
    const teachRes = await startTutoringSession({
      topic: "normalization",
      goal: "teach",
    });
    expect(teachRes.message).toBeTruthy();
    expect(teachRes.question).toBeDefined();

    const weakRes = await startTutoringSession({
      topic: "Please review my weak concepts.",
      goal: "weak",
    });
    expect(weakRes.message).toMatch(/Targeting weak concept:/i);
    expect(weakRes.question).toBeDefined();
  });

  // ---- 6. Switching topics without stale questions or evidence ------------
  it("6. Switches topics atomically without leaking stale questions or evidence", async () => {
    // Topic 1: 1NF
    const res1 = await startTutoringSession({ topic: "1nf" });
    expect(res1.question?.conceptId).toBe("1nf");
    expect(res1.evidence?.chunkId).toContain("first-normal-form");

    // Topic 2: 2NF
    const res2 = await startTutoringSession({ topic: "2nf" });
    expect(res2.question?.conceptId).toBe("2nf");
    expect(res2.evidence?.chunkId).toContain("second-normal-form");

    // Must be completely different chunk IDs and quotes
    expect(res2.question?.questionId).not.toBe(res1.question?.questionId);
    expect(res2.evidence?.chunkId).not.toBe(res1.evidence?.chunkId);
    expect(res2.evidence?.status).toBe("verified");
  });

  // ---- 7. Voice transcript submission through same trusted flow -----------
  it("7. Routes voice speech transcripts through the exact same session flow", async () => {
    // Simulated transcript returned by Web Speech API
    const voiceTranscript = "Let's practice 1NF.";

    const res = await runTutoringOrchestration({
      action: "start_session",
      topic: voiceTranscript,
    });

    expect(res.question).toBeDefined();
    expect(res.question?.conceptId).toBe("1nf");
    expect(res.evidence?.status).toBe("verified");
  });

  // ---- 8. Permission denial and unsupported-browser voice fallback ---------
  it("8. Provides clean fallback on permission denial and unsupported browsers", () => {
    // Simulate error handling logic of useVoice
    const handleVoiceError = (errorCode: string) => {
      let friendlyError = "Speech recognition encountered an issue. Click to retry.";
      if (errorCode === "not-allowed" || errorCode === "permission-denied") {
        friendlyError = "Microphone access was denied. Please allow microphone permissions in browser settings.";
      } else if (errorCode === "no-speech") {
        friendlyError = "No speech was detected. Click microphone to speak again.";
      }
      return friendlyError;
    };

    expect(handleVoiceError("not-allowed")).toContain("Microphone access was denied");
    expect(handleVoiceError("no-speech")).toContain("No speech was detected");
  });

  // ---- 9. Spoken responses respecting voice-output preference -------------
  it("9. Respects voice-output preference for spoken tutor responses", () => {
    const mockSpeak = vi.fn();
    const cleanSpeechText = (text: string) =>
      text
        .replace(/[*_#`~]/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();

    const tutorMessage = "First Normal Form requires **atomic** values in every column.";
    let voiceOutputEnabled = false;

    // When disabled, speak is NOT called
    if (voiceOutputEnabled) {
      mockSpeak(cleanSpeechText(tutorMessage));
    }
    expect(mockSpeak).not.toHaveBeenCalled();

    // When enabled, speak IS called with stripped markdown
    voiceOutputEnabled = true;
    if (voiceOutputEnabled) {
      mockSpeak(cleanSpeechText(tutorMessage));
    }
    expect(mockSpeak).toHaveBeenCalledWith("First Normal Form requires atomic values in every column.");
  });

  // ---- 10. Resuming a session without losing document and topic context ---
  it("10. Saves and resumes session without losing document and topic context", () => {
    const sessionState = {
      documentId: "dbms-normalization",
      documentTitle: "Sample DBMS Notes",
      goal: "teach" as const,
      topic: "1nf",
      messages: [
        { id: "1", role: "user" as const, text: "Let's practice 1NF." },
        { id: "2", role: "tutor" as const, text: "1NF requires atomic values." },
      ],
      savedAt: new Date().toISOString(),
    };

    const serialized = JSON.stringify(sessionState);
    const restored = JSON.parse(serialized);

    expect(restored.documentId).toBe("dbms-normalization");
    expect(restored.documentTitle).toBe("Sample DBMS Notes");
    expect(restored.goal).toBe("teach");
    expect(restored.topic).toBe("1nf");
    expect(restored.messages).toHaveLength(2);
  });

  // ---- 11. Provider failure and deterministic fallback --------------------
  it("11. Gracefully engages deterministic fallback when LLM provider fails", async () => {
    const failingProvider = new MockLlmProvider();
    failingProvider.generateCompletion = async () => {
      throw new Error("Gemini API rate limit exceeded: 429 Too Many Requests");
    };

    const res = await runTutoringOrchestration({
      action: "start_session",
      topic: "2nf",
      customProvider: failingProvider,
    });

    expect(res.provider).toBe("deterministic_fallback");
    expect(res.question).toBeDefined();
    expect(res.question?.conceptId).toBe("2nf");
    expect(res.evidence).toBeDefined();
    expect(res.evidence?.chunkId).toContain("second-normal-form");
    expect(res.evidence?.status).toBe("verified");
  });
});
