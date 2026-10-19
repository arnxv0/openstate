const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

const MODELS = [
  GEMINI_MODEL,
  ...(process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.6-flash,gemini-3-flash-preview,gemini-3.5-flash-lite")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean),
].filter((model, index, all) => all.indexOf(model) === index);

const THINKING_MODELS = new Set(["gemini-3.8-flash"]);
const TIMEOUT_MS = 12000;
const BENCH_MS = 30 * 1000;

const benchedUntil = new Map<string, number>();

type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type GeminiResult<T> = {
  data: T;
  model: string;
  usage: { input: number; output: number; total: number };
  latencyMs: number;
};

export function hasGemini() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Small fallback models answer fast but cannot be trusted with fine visual distinctions. */
export const isLiteModel = (model: string) => /lite/.test(model);

async function call(model: string, key: string, system: string, parts: Part[], timeoutMs: number) {
  const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
        ...(THINKING_MODELS.has(model) ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Gemini ${model} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
}

export async function generateJson<T>({
  system,
  parts,
  timeoutMs = TIMEOUT_MS,
}: {
  system: string;
  parts: Part[];
  timeoutMs?: number;
  /** Accepted for parity with the OpenAI client; Gemini thinking is set per model. */
  reasoning?: string;
}): Promise<GeminiResult<T>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");

  const now = Date.now();
  const available = MODELS.filter((model) => (benchedUntil.get(model) ?? 0) <= now);
  const order = available.length ? available : MODELS;
  const failures: string[] = [];

  for (const model of order) {
    const started = performance.now();
    try {
      const body = await call(model, key, system, parts, timeoutMs);
      const text =
        body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      const data = JSON.parse(text) as T;
      benchedUntil.delete(model);
      return {
        data,
        model,
        usage: {
          input: body.usageMetadata?.promptTokenCount ?? 0,
          output: body.usageMetadata?.candidatesTokenCount ?? 0,
          total: body.usageMetadata?.totalTokenCount ?? 0,
        },
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/ (429|5\d\d):/.test(message)) benchedUntil.set(model, Date.now() + BENCH_MS);
      console.warn(`[gemini] ${model} failed: ${message.slice(0, 200)}`);
      failures.push(message);
    }
  }

  throw new Error(`All Gemini models failed: ${failures.join(" | ")}`);
}
