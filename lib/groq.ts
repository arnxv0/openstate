import type { Part, StepRequest, StepResult, ToolCall, Turn } from "@/lib/agent-types";
import { errorText, log } from "@/lib/log";

// Groq as a model provider: answers in well under a second. Each free key
// allows 8,000 tokens a minute, so calls rotate across GROQ_API_KEYS and a
// rate-limited key is rested for a minute. Text goes to GROQ_MODEL; anything
// with photos goes to GROQ_VISION_MODEL, which accepts MAX_IMAGES images per
// call, so callers trim what they send (see imageBudget).

const URL = "https://api.groq.com/openai/v1/chat/completions";
const TEXT_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
const VISION_MODEL = process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b";
const TIMEOUT_MS = 8000;
const REST_MS = 60_000;
export const MAX_IMAGES = 3;

const keys = (process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

const restingUntil = new Map<number, number>();
let cursor = 0;

export const hasGroq = () => keys.length > 0;
export const groqKeyCount = () => keys.length;

/** Order to try keys in: round-robin from the cursor, skipping rested ones. */
export function keyOrder(count: number, start: number, resting: Map<number, number>, now: number) {
  return Array.from({ length: count }, (_, offset) => (start + offset) % count).filter(
    (index) => (resting.get(index) ?? 0) <= now,
  );
}

/**
 * Which photos to send when only `max` fit: `refs[i]` reference photos of
 * candidate i, and the indexes of the episode frames to keep. Change is read
 * from the first and last frame, so those always go; what is left over buys
 * one reference photo for the first candidates (callers put the likeliest
 * first), then middle frames.
 */
export function imageBudget(max: number, referenceCounts: number[], frameCount: number) {
  const total = referenceCounts.reduce((sum, count) => sum + count, 0) + frameCount;
  if (total <= max) {
    return { refs: referenceCounts, frames: Array.from({ length: frameCount }, (_, index) => index) };
  }
  const keep = new Set<number>();
  if (frameCount > 0) keep.add(frameCount - 1);
  if (frameCount > 1 && keep.size < max) keep.add(0);
  let left = max - keep.size;
  const refs = referenceCounts.map((count) => {
    if (left <= 0 || count === 0) return 0;
    left -= 1;
    return 1;
  });
  // Spare slots go to evenly spaced middle frames.
  for (let slot = 1; left > 0 && keep.size < frameCount; slot++) {
    const index = Math.round((slot * (frameCount - 1)) / (left + 1));
    if (!keep.has(index)) {
      keep.add(index);
      left -= 1;
    } else if (slot > frameCount) break;
  }
  return { refs, frames: [...keep].sort((a, b) => a - b) };
}

class TooLarge extends Error {}
class RateLimited extends Error {}
/** Groq rejected the model's own tool call; `generation` is what the model tried to say. */
class ToolUseFailed extends Error {
  readonly generation: string;
  constructor(message: string, generation: string) {
    super(message);
    this.generation = generation;
  }
}

// gpt-oss reads "respond with JSON" as a tool named json when tools are on
// offer; the request fails with the answer inside failed_generation.
const NO_JSON_TOOL =
  '\n\nThere is no tool named "json". To answer, write the JSON object directly as your message text, never as a tool call.';

/** The answer out of a rejected generation: the arguments of a bogus "json" call, or the JSON in the text. */
export function salvageJson(generation: string) {
  const start = generation.indexOf("{");
  const end = generation.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const text = generation.slice(start, end + 1);
  try {
    const parsed = JSON.parse(text) as { name?: unknown; arguments?: unknown };
    if (parsed && typeof parsed === "object" && parsed.arguments && typeof parsed.arguments === "object") {
      return JSON.stringify(parsed.arguments);
    }
    return text;
  } catch {
    return null;
  }
}

export type GroqResult<T> = {
  data: T;
  model: string;
  usage: { input: number; output: number; total: number };
  latencyMs: number;
};

function toContent(part: Part) {
  if ("text" in part) return { type: "text", text: part.text };
  return {
    type: "image_url",
    image_url: { url: `data:${part.inline_data.mime_type};base64,${part.inline_data.data}` },
  };
}

/** Text-only requests use a plain string: the text model rejects parts. */
const userContent = (parts: Part[], images: number) =>
  images > 0 ? parts.map(toContent) : parts.map((part) => ("text" in part ? part.text : "")).join("\n");

type ChatBody = {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const usageOf = (body: ChatBody) => ({
  input: body.usage?.prompt_tokens ?? 0,
  output: body.usage?.completion_tokens ?? 0,
  total: body.usage?.total_tokens ?? 0,
});

async function send(key: string, body: Record<string, unknown>, timeoutMs: number, model: string, images: number) {
  const response = await fetch(URL, {
    method: "POST",
    signal: AbortSignal.timeout(Math.min(timeoutMs, TIMEOUT_MS)),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, temperature: 0.2, ...body }),
  });
  if (response.status === 429 || response.status === 413) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
    // "Request too large" is about this request, not the key: every key
    // would refuse it, and resting them would starve later small calls.
    if (/too large/i.test(detail)) {
      log("groq", "request too large for the per-minute limit", { model, images, detail });
      throw new TooLarge(detail);
    }
    throw new RateLimited(detail);
  }
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 400 && /tool_use_failed/.test(text)) {
      let generation = "";
      try {
        generation = (JSON.parse(text) as { error?: { failed_generation?: string } }).error?.failed_generation ?? "";
      } catch {
        // Not JSON: nothing to salvage.
      }
      throw new ToolUseFailed(`400: ${text.slice(0, 200)}`, generation);
    }
    throw new Error(`${response.status}: ${text.slice(0, 200)}`);
  }
  return (await response.json()) as ChatBody;
}

/** Runs `attempt` with each key in rotation until one answers. Throws when none could. */
async function withKeys<T>(model: string, attempt: (key: string) => Promise<T>): Promise<T> {
  if (keys.length === 0) throw new Error("GROQ_API_KEYS is not set");
  const order = keyOrder(keys.length, cursor, restingUntil, Date.now());
  cursor = (cursor + 1) % keys.length;
  let last = "every key is resting after a rate limit";
  for (const index of order) {
    try {
      return await attempt(keys[index]);
    } catch (cause) {
      if (cause instanceof TooLarge) throw new Error(`groq: ${cause.message}`);
      if (cause instanceof RateLimited) {
        restingUntil.set(index, Date.now() + REST_MS);
        last = `key ${index + 1} rate limited`;
        log("groq", "key rate limited, resting it for a minute", { key: index + 1, model, detail: cause.message });
        continue;
      }
      last = `key ${index + 1}: ${errorText(cause)}`;
      log("groq", "call failed", { key: index + 1, model, error: errorText(cause) });
    }
  }
  throw new Error(`groq: ${last}`);
}

/** JSON from Groq. Throws when no key could answer, so the caller can fall back. */
export async function generateJson<T>({
  system,
  parts,
  timeoutMs = TIMEOUT_MS,
}: {
  system: string;
  parts: Part[];
  timeoutMs?: number;
  reasoning?: string;
}): Promise<GroqResult<T>> {
  const images = parts.filter((part) => "inline_data" in part).length;
  if (images > MAX_IMAGES) throw new Error(`groq: ${images} images, at most ${MAX_IMAGES} fit`);
  const model = images > 0 ? VISION_MODEL : TEXT_MODEL;
  const started = performance.now();
  return withKeys(model, async (key) => {
    const body = await send(
      key,
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent(parts, images) },
        ],
        response_format: { type: "json_object" },
        // The vision model allows 1,000 output tokens a minute per key.
        max_completion_tokens: images > 0 ? 900 : 1200,
      },
      timeoutMs,
      model,
      images,
    );
    const data = JSON.parse(body.choices?.[0]?.message?.content ?? "") as T;
    const latencyMs = Math.round(performance.now() - started);
    log("groq", "ok", { model, images, tokens: body.usage?.total_tokens, ms: latencyMs });
    return { data, model: `groq:${model}`, usage: usageOf(body), latencyMs };
  });
}

const parseArguments = (text: string) => {
  try {
    const parsed = JSON.parse(text || "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Earlier turns as chat messages; assistant tool calls are rebuilt from the neutral record. */
export function toMessages(system: string, transcript: Turn[], images: number) {
  const messages: unknown[] = [{ role: "system", content: system }];
  for (const turn of transcript) {
    if (turn.role === "user") {
      messages.push({ role: "user", content: userContent(turn.parts, images) });
    } else if (turn.role === "assistant") {
      messages.push({
        role: "assistant",
        content: turn.text ?? "",
        ...(turn.calls.length
          ? {
              tool_calls: turn.calls.map((call: ToolCall) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            }
          : {}),
      });
    } else {
      for (const result of turn.results) {
        messages.push({ role: "tool", tool_call_id: result.id, content: result.output });
      }
    }
  }
  return messages;
}

/** One step of the tool loop. No JSON mode here (it clashes with tools); the loop parses loosely. */
export async function stepWithTools({
  system,
  transcript,
  tools,
  toolChoice = "auto",
  timeoutMs = TIMEOUT_MS,
}: StepRequest): Promise<StepResult> {
  const images = transcript
    .flatMap((turn) => (turn.role === "user" ? turn.parts : []))
    .filter((part) => "inline_data" in part).length;
  if (images > MAX_IMAGES) throw new Error(`groq: ${images} images, at most ${MAX_IMAGES} fit`);
  const model = images > 0 ? VISION_MODEL : TEXT_MODEL;
  const started = performance.now();
  return withKeys(model, async (key) => {
    let body: ChatBody;
    try {
      body = await send(
        key,
        {
          messages: toMessages(tools.length ? system + NO_JSON_TOOL : system, transcript, images),
          tools: tools.map((tool) => ({
            type: "function",
            function: { name: tool.name, description: tool.description, parameters: tool.parameters },
          })),
          tool_choice: toolChoice,
          max_completion_tokens: images > 0 ? 900 : 1500,
        },
        timeoutMs,
        model,
        images,
      );
    } catch (cause) {
      const salvaged = cause instanceof ToolUseFailed ? salvageJson(cause.generation) : null;
      if (!salvaged) throw cause;
      const latencyMs = Math.round(performance.now() - started);
      log("groq", "answer salvaged from a rejected tool call", { model, ms: latencyMs });
      return { text: salvaged, calls: [], raw: [], model: `groq:${model}`, usage: { input: 0, output: 0, total: 0 }, latencyMs };
    }
    const message = body.choices?.[0]?.message;
    const calls: ToolCall[] = (message?.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    }));
    const latencyMs = Math.round(performance.now() - started);
    log("groq", "ok", { model, images, tools: calls.map((call) => call.name), tokens: body.usage?.total_tokens, ms: latencyMs });
    return {
      text: message?.content?.trim() || null,
      calls,
      raw: message?.tool_calls ?? [],
      model: `groq:${model}`,
      usage: usageOf(body),
      latencyMs,
    };
  });
}
