import type { Part, StepRequest, StepResult, ToolCall, Turn } from "@/lib/agent-types";

// OpenAI Responses API client with the same contract as lib/gemini.ts:
// JSON-only answers, an ordered model list, and short benching of models that
// rate-limit or error so one bad model does not slow every call. stepWithTools
// adds one step of the tool-calling loop in lib/agent.ts.
//
// Routes: every call tries the routes in order; a route is skipped when all
// its models fail, time out or its credit is gone. MODEL_ROUTE picks the
// order: "openai" (default) is api.openai.com first and Flatkey's router as
// the fallback; "flatkey" is the reverse; "openai-only" never touches
// Flatkey. OPENAI_BASE_URL repoints the OpenAI route.

type RouteName = "flatkey" | "openai";
type Route = { name: RouteName; base: string; key: string; models: string[]; timeoutMs: number };

const MODEL_ROUTE = process.env.MODEL_ROUTE ?? "openai";
const FORCE_OPENAI = MODEL_ROUTE === "openai-only";

const modelList = (primary: string, fallbacks: string) =>
  [primary, ...fallbacks.split(",").map((model) => model.trim()).filter(Boolean)].filter(
    (model, index, all) => all.indexOf(model) === index,
  );

function routes(): Route[] {
  const list: Route[] = [];
  const flatkey = FORCE_OPENAI ? "" : (process.env.FLATKEY_API_KEY ?? "");
  if (process.env.OPENAI_API_KEY) {
    list.push({
      name: "openai",
      base: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      key: process.env.OPENAI_API_KEY,
      models: modelList(process.env.OPENAI_MODEL ?? "gpt-5.4-mini", process.env.OPENAI_FALLBACK_MODELS ?? "gpt-4.1-mini"),
      timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 12_000),
    });
  }
  if (flatkey) {
    list.push({
      name: "flatkey",
      base: "https://router.flatkey.ai/v1",
      key: flatkey,
      models: modelList(process.env.FLATKEY_MODEL ?? "gpt-5.6-terra", process.env.FLATKEY_FALLBACK_MODELS ?? "gpt-5.5"),
      // Routed models answer more slowly than gpt-5.4-mini direct.
      timeoutMs: Number(process.env.FLATKEY_TIMEOUT_MS ?? 25_000),
    });
  }
  if (MODEL_ROUTE === "flatkey") list.reverse();
  return list;
}

/** The key the first route uses; kept for callers that only need to know a key exists. */
export const apiKey = () => routes()[0]?.key ?? "";
export const MISSING_OPENAI_KEY = "FLATKEY_API_KEY or OPENAI_API_KEY is not set";
/** Which route a call starts on. */
export const activeRoute = (): RouteName | null => routes()[0]?.name ?? null;

// Reasoning models answer a fridge frame in ~1.8 s with effort "none" and
// ~2.5 s with "low"; perception needs looking, not thinking.
const REASONING_EFFORT = process.env.OPENAI_REASONING ?? "none";
const REASONING_MODELS = /^(gpt-5|gpt-6|o\d)/;
// Frames are 640 px wide. "low" shrinks them further, which turns a can on a
// table a couple of metres away into a few pixels and costs counts; "high"
// is a few thousand more tokens per episode.
const IMAGE_DETAIL = process.env.OPENAI_IMAGE_DETAIL === "low" ? "low" : "high";
// A tool-loop step carries tool output and gets more time on every route.
const STEP_TIMEOUT_MS = Number(process.env.OPENAI_STEP_TIMEOUT_MS ?? 45_000);
const BENCH_MS = 30 * 1000;

const benchedUntil = new Map<string, number>();

export type OpenAIResult<T> = {
  data: T;
  model: string;
  usage: { input: number; output: number; total: number };
  latencyMs: number;
};

export function hasOpenAI() {
  return routes().length > 0;
}

/** Nano-class models misread fine visual detail and must not decide identity. */
export const isLiteOpenAIModel = (model: string) => /nano/.test(model);

type Content =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" };

function toContent(part: Part): Content {
  if ("text" in part) return { type: "input_text", text: part.text };
  return {
    type: "input_image",
    image_url: `data:${part.inline_data.mime_type};base64,${part.inline_data.data}`,
    detail: IMAGE_DETAIL,
  };
}

type OutputItem = {
  type: string;
  id?: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
};

type ResponsesBody = {
  output?: OutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

const usageOf = (body: ResponsesBody) => ({
  input: body.usage?.input_tokens ?? 0,
  output: body.usage?.output_tokens ?? 0,
  total: body.usage?.total_tokens ?? 0,
});

const messageText = (output: OutputItem[]) =>
  output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("");

function modelSettings(model: string, reasoning: string) {
  if (!REASONING_MODELS.test(model)) return { temperature: 0.2 };
  // With store:false a reasoning model's thoughts must travel back with the
  // next step's function-call items, encrypted, or it refuses them.
  return { reasoning: { effort: reasoning }, include: ["reasoning.encrypted_content"] };
}

async function request(route: Route, model: string, body: Record<string, unknown>, timeoutMs: number) {
  const response = await fetch(`${route.base}/responses`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${route.key}` },
    body: JSON.stringify({ model, store: false, ...body }),
  });
  if (!response.ok) {
    throw new Error(`${route.name} ${model} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as ResponsesBody;
}

/**
 * Tries every route in order and every model of a route in order, skipping
 * ones recently rate limited, out of credit or erroring. `run` gets the
 * route's own timeout unless the caller fixed one.
 */
async function withModels<T>(run: (route: Route, model: string, timeoutMs: number) => Promise<T>, timeoutMs?: number): Promise<T> {
  const all = routes();
  if (all.length === 0) throw new Error(MISSING_OPENAI_KEY);
  const now = Date.now();
  const failures: string[] = [];
  for (const route of all) {
    const available = route.models.filter((model) => (benchedUntil.get(`${route.name}:${model}`) ?? 0) <= now);
    const order = available.length ? available : route.models;
    for (const model of order) {
      const id = `${route.name}:${model}`;
      try {
        const result = await run(route, model, timeoutMs ?? route.timeoutMs);
        benchedUntil.delete(id);
        return result;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (/ (402|429|5\d\d):/.test(message) || /aborted|timed out/i.test(message)) benchedUntil.set(id, Date.now() + BENCH_MS);
        console.warn(`[${route.name}] ${model} failed: ${message.slice(0, 200)}`);
        failures.push(message);
      }
    }
  }
  throw new Error(`All models failed: ${failures.join(" | ")}`);
}

export async function generateJson<T>({
  system,
  parts,
  timeoutMs,
  reasoning = REASONING_EFFORT,
}: {
  system: string;
  parts: Part[];
  timeoutMs?: number;
  /** Reasoning effort for reasoning models; defaults to OPENAI_REASONING or "none". */
  reasoning?: string;
}): Promise<OpenAIResult<T>> {
  return withModels(async (route, model, limit) => {
    const started = performance.now();
    const body = await request(
      route,
      model,
      {
        // The system prompt goes in the input (not `instructions`) because JSON
        // mode requires the word "json" to appear in an input message.
        input: [
          { role: "developer", content: [{ type: "input_text", text: system }] },
          { role: "user", content: parts.map(toContent) },
        ],
        text: { format: { type: "json_object" } },
        ...modelSettings(model, reasoning),
      },
      limit,
    );
    const data = JSON.parse(messageText(body.output ?? [])) as T;
    return { data, model, usage: usageOf(body), latencyMs: Math.round(performance.now() - started) };
  }, timeoutMs);
}

const parseArguments = (text: string | undefined) => {
  try {
    const parsed = JSON.parse(text || "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

// Output item types this client produces and may hand back; anything else
// (Groq's tool_calls carry type "function") came from another provider.
const RESPONSES_ITEMS = new Set(["message", "function_call", "reasoning"]);

/** Earlier turns as Responses input items. */
export function toInput(system: string, transcript: Turn[]) {
  const input: unknown[] = [{ role: "developer", content: [{ type: "input_text", text: system }] }];
  for (const turn of transcript) {
    if (turn.role === "user") {
      input.push({ role: "user", content: turn.parts.map(toContent) });
    } else if (turn.role === "assistant") {
      // Our own output items (reasoning, function calls, messages) go back as
      // they came; a turn made by another provider is rebuilt from its calls.
      const own =
        Array.isArray(turn.raw) &&
        turn.raw.length > 0 &&
        turn.raw.every(
          (item) => item && typeof item === "object" && RESPONSES_ITEMS.has((item as { type?: string }).type ?? ""),
        );
      if (own) input.push(...(turn.raw as OutputItem[]));
      else
        input.push(
          ...turn.calls.map((call: ToolCall) => ({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          })),
        );
    } else {
      for (const result of turn.results) {
        input.push({ type: "function_call_output", call_id: result.id, output: result.output });
      }
    }
  }
  return input;
}

/** One step of the tool loop: the model either calls tools or answers in JSON. */
export async function stepWithTools({
  system,
  transcript,
  tools,
  toolChoice = "auto",
  timeoutMs = STEP_TIMEOUT_MS,
  reasoning = REASONING_EFFORT,
}: StepRequest): Promise<StepResult> {
  return withModels(async (route, model, limit) => {
    const started = performance.now();
    const body = await request(
      route,
      model,
      {
        input: toInput(system, transcript),
        tools: tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: false,
        })),
        tool_choice: toolChoice,
        text: { format: { type: "json_object" } },
        ...modelSettings(model, reasoning),
      },
      limit,
    );
    const output = body.output ?? [];
    const calls: ToolCall[] = output
      .filter((item) => item.type === "function_call" && item.call_id && item.name)
      .map((item) => ({ id: item.call_id!, name: item.name!, arguments: parseArguments(item.arguments) }));
    const text = messageText(output);
    return {
      text: text || null,
      calls,
      raw: output,
      model,
      usage: usageOf(body),
      latencyMs: Math.round(performance.now() - started),
    };
  }, timeoutMs);
}
