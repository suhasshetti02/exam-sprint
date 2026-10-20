import { NextResponse } from "next/server";
import { z } from "zod";
import {
  startChallenge,
  answerChallengeSlot,
  loadChallenge,
  listRecentChallenges,
} from "@/lib/server/challenge-service";

export const dynamic = "force-dynamic";

const challengeRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("answer"),
    challengeId: z.string().min(1).max(120),
    slotIndex: z.number().int().min(0).max(10),
    answer: z.string().trim().min(1).max(2000),
  }),
  z.object({
    action: z.literal("get_state"),
    challengeId: z.string().min(1).max(120),
  }),
  z.object({ action: z.literal("list_recent") }),
]);

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

  const parsed = challengeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", message: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  try {
    if (data.action === "start") {
      const result = await startChallenge();
      return NextResponse.json(result);
    }

    if (data.action === "answer") {
      const result = await answerChallengeSlot(data.challengeId, data.slotIndex, data.answer);
      return NextResponse.json(result);
    }

    if (data.action === "get_state") {
      const result = await loadChallenge(data.challengeId);
      return NextResponse.json(result);
    }

    if (data.action === "list_recent") {
      const result = listRecentChallenges();
      return NextResponse.json({ runs: result });
    }

    return NextResponse.json({ error: "unhandled_action" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Challenge operation failed";

    // Duplicate submission — return 409 Conflict
    if (message.startsWith("DUPLICATE:") || message.includes("already answered")) {
      return NextResponse.json({ error: "conflict", message }, { status: 409 });
    }

    // Not found
    if (message.includes("not found")) {
      return NextResponse.json({ error: "not_found", message }, { status: 404 });
    }

    return NextResponse.json({ error: "challenge_error", message }, { status: 503 });
  }
}
