import { NextResponse } from "next/server";
import { z } from "zod";
import { runTutoringOrchestration } from "@/lib/server/llm/orchestrator";
import { loadInitialMasteryState } from "@/lib/server/tutoring-policy";

export const dynamic = "force-dynamic";

const sessionRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start_session"),
    topic: z.string().max(200).optional(),
    focus: z.enum(["new", "weak", "review"]).optional(),
    documentId: z.string().max(100).optional(),
    goal: z.enum(["teach", "quiz", "weak", "full_document"]).optional(),
  }),
  z.object({
    action: z.literal("submit_answer"),
    questionId: z.string().min(1).max(80),
    answer: z.string().trim().min(1).max(2000),
    recoveryForMisconceptionLabel: z.string().min(1).max(200).optional(),
  }),
  z.object({
    action: z.literal("get_state"),
  }),
]);

export async function GET() {
  try {
    const state = await loadInitialMasteryState();
    return NextResponse.json(state);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load state";
    return NextResponse.json({ error: "mcp_error", message }, { status: 503 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Malformed JSON body" },
      { status: 400 },
    );
  }

  const parsed = sessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "Invalid session request",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const data = parsed.data;

  try {
    if (data.action === "start_session") {
      const response = await runTutoringOrchestration({
        action: "start_session",
        topic: data.topic,
        focus: data.focus,
        documentId: data.documentId,
        goal: data.goal,
      });
      return NextResponse.json(response);
    }

    if (data.action === "submit_answer") {
      const response = await runTutoringOrchestration({
        action: "submit_answer",
        questionId: data.questionId,
        answer: data.answer,
        recoveryForMisconceptionLabel: data.recoveryForMisconceptionLabel,
      });
      return NextResponse.json(response);
    }

    if (data.action === "get_state") {
      const state = await loadInitialMasteryState();
      return NextResponse.json(state);
    }

    return NextResponse.json({ error: "unhandled_action" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Tutoring operation failed";
    return NextResponse.json({ error: "mcp_error", message }, { status: 503 });
  }
}
