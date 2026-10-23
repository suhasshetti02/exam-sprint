import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteDocument, ingestDocument } from "../lib/server/document-service";
import { MockLlmProvider } from "../lib/server/llm/providers";
import { runTutoringOrchestration } from "../lib/server/llm/orchestrator";
import type { LlmProvider } from "../lib/server/llm/types";

describe("Direct questions over the active study document", () => {
  let documentId: string;
  let objectiveOnlyDocumentId: string;
  let definitionChunkId: string;

  beforeAll(async () => {
    const definition = await ingestDocument(
      "Computer Graphics Definition.md",
      Buffer.from(`# Learning Objectives\nComputer graphics students should learn how computers create and display visual images.\n\n# Definition of Computer Graphics\nComputer Graphics (CG) is the field that deals with creating and manipulating visual content using computers.`, "utf8"),
    );
    const objectiveOnly = await ingestDocument(
      "Computer Graphics Objectives.md",
      Buffer.from(`# Learning Objectives\nComputer graphics students should learn how computers create and display visual images.`, "utf8"),
    );
    expect(definition.success).toBe(true);
    expect(objectiveOnly.success).toBe(true);
    documentId = definition.documentId!;
    objectiveOnlyDocumentId = objectiveOnly.documentId!;
    const { openDb } = await import("../lib/server/document-service");
    const db = openDb();
    definitionChunkId = (db.prepare(
      "SELECT id FROM chunks WHERE document_id = ? AND heading = ?",
    ).get(documentId, "Definition of Computer Graphics") as { id: string }).id;
    db.close();
  });

  afterAll(() => {
    if (documentId) deleteDocument(documentId);
    if (objectiveOnlyDocumentId) deleteDocument(objectiveOnlyDocumentId);
  });

  it("retrieves a definition instead of presenting the learning objective as the answer", async () => {
    const provider = new MockLlmProvider([{
      content: "Computer graphics is the field of creating and manipulating visual content with computers.",
      finishReason: "stop",
    }]);
    const response = await runTutoringOrchestration({
      action: "start_session",
      requestType: "question",
      topic: "What is computer graphics?",
      documentId,
      goal: "teach",
      customProvider: provider,
    });

    expect(response.message).toContain("field of creating");
    expect(response.message).not.toContain("Let's study");
    expect(response.question).toBeUndefined();
    expect(response.evidence?.status).toBe("verified");
    expect(response.evidence?.quote).toContain("is the field that deals with");
    expect(response.evidence?.quote).toMatch(/^Computer Graphics/);
    expect(response.evidence?.quote).not.toMatch(/^Introduction to Computer Graphics/);
    expect(response.evidence?.quote).not.toContain("Learning Objectives");
    expect(response.executionMetadata?.executionPath).toBe("live_model");
    expect(provider.recordedMessages[0]?.[1]?.content).toContain("What is computer graphics?");
    expect(provider.recordedMessages[0]?.[1]?.content).toContain(response.evidence?.quote);
  });

  it("routes a quick overview to active-topic evidence and preserves the original request", async () => {
    const provider = new MockLlmProvider([{
      content: "Your notes describe computer graphics as creating and manipulating visual content with computers.",
      finishReason: "stop",
    }]);
    const response = await runTutoringOrchestration({
      action: "start_session",
      requestType: "question",
      topic: "Can you give me the quick cover of this topic?",
      contextQuestion: "What is Computer Graphics?",
      contextChunkId: definitionChunkId,
      documentId,
      goal: "quiz",
      customProvider: provider,
    });

    expect(response.message).toContain("creating and manipulating");
    expect(response.evidence?.chunkId).toBe(definitionChunkId);
    expect(provider.recordedMessages[0]?.[1]?.content).toContain("Can you give me the quick cover");
  });

  it("returns the closest verified objective passage honestly when the notes lack a definition", async () => {
    const response = await runTutoringOrchestration({
      action: "start_session",
      requestType: "question",
      topic: "What is computer graphics?",
      documentId: objectiveOnlyDocumentId,
      goal: "teach",
      customProvider: null as unknown as LlmProvider,
    });

    expect(response.provider).toBe("deterministic_fallback");
    expect(response.executionMetadata?.fallbackReason).toContain("does not answer");
    expect(response.message).toContain("don't clearly answer");
    expect(response.message).toContain("closest relevant verified passage");
    expect(response.evidence?.status).toBe("verified");
    expect(response.evidence?.quote).toContain("Computer graphics students");
    expect(response.message).not.toMatch(/computer graphics is the field/i);
  });

  it("falls back to the verified passage when a live model request fails", async () => {
    const failingProvider: LlmProvider = {
      id: "mock-gemini",
      model: "mock-gemini-flash",
      isAvailable: () => true,
      generateCompletion: async () => { throw new Error("provider HTTP 503"); },
    };
    const response = await runTutoringOrchestration({
      action: "start_session",
      requestType: "question",
      topic: "What is computer graphics?",
      documentId,
      goal: "teach",
      customProvider: failingProvider,
    });

    expect(response.provider).toBe("deterministic_fallback");
    expect(response.executionMetadata?.executionPath).toBe("deterministic_fallback");
    expect(response.executionMetadata?.fallbackReason).toBe("Live model request failed");
    expect(response.message).toContain(response.evidence?.quote);
  });

  it("keeps follow-up questions scoped to the active document and concept context", async () => {
    const provider = new MockLlmProvider([
      { content: "Your notes say computer graphics creates and manipulates visual content with computers.", finishReason: "stop" },
    ]);
    const response = await runTutoringOrchestration({
      action: "start_session",
      requestType: "question",
      topic: "Why?",
      documentId,
      contextChunkId: definitionChunkId,
      activeConceptId: "computer-graphics",
      goal: "teach",
      customProvider: provider,
    });

    expect(response.executionMetadata?.executionPath).toBe("live_model");
    expect(response.evidence?.chunkId).toBe(definitionChunkId);
    expect(provider.recordedMessages[0]?.[1]?.content).toContain(`Current concept context: computer-graphics`);
    expect(provider.recordedMessages[0]?.[1]?.content).toContain("Selected document: Computer Graphics Definition");
  });
});
