import { isObserverId } from "@/lib/signal-store";
import type { VoiceSnapshot, VoiceState } from "@/lib/types";
import { publishVoice } from "@/lib/voice-bus";

const STATES = new Set<VoiceState>([
  "off",
  "connecting",
  "sleeping",
  "awake",
  "thinking",
  "speaking",
  "error",
]);

const clip = (value: unknown) => (typeof value === "string" ? value.slice(0, 600) : "");

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<VoiceSnapshot>;
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  if (!body.state || !STATES.has(body.state)) {
    return Response.json({ error: "bad state" }, { status: 400 });
  }

  publishVoice({
    observerId: body.observerId,
    state: body.state,
    partial: clip(body.partial),
    question: clip(body.question),
    answer: clip(body.answer),
    at: Date.now(),
  });
  return new Response(null, { status: 204 });
}
