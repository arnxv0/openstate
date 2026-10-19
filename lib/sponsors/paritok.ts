import { errorText, log } from "@/lib/log";
import { requestJson } from "@/lib/sponsors/http";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";

// Paritok: non-destructive context compression. Tool outputs and the memory
// block that go back into the model are shrunk by Paritok's 4B model, keyed
// to the question, so a research result or a long event list costs a
// fraction of the tokens. Without a key, text passes through unchanged.

const ENDPOINT = "https://www.paritok.com/api/compress";
const MIN_CHARS = Number(process.env.PARITOK_MIN_CHARS ?? 1500);
const TIMEOUT_MS = 8000;

export const hasParitok = () => Boolean(process.env.PARITOK_API_KEY);

type CompressResponse = {
  compressed?: string;
  gpu_available?: boolean;
  original_tokens?: number;
  compressed_tokens?: number;
};

export type Compressed = { text: string; compressed: boolean; originalTokens?: number; compressedTokens?: number };

/** The text as Paritok returns it; the original when not configured or on any failure. */
export async function compress(content: string, query: string, upstreamModel = process.env.OPENAI_MODEL ?? "gpt-5.4-mini"): Promise<Compressed> {
  if (!hasParitok()) return { text: content, compressed: false };
  try {
    const body = await requestJson<CompressResponse>(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.PARITOK_API_KEY}` },
      body: { content, query, upstream_model: upstreamModel },
      timeoutMs: TIMEOUT_MS,
    });
    if (!body.gpu_available || !body.compressed) return { text: content, compressed: false };
    log("paritok", "compressed", { from: body.original_tokens, to: body.compressed_tokens, query: query.slice(0, 80) });
    return {
      text: body.compressed,
      compressed: true,
      originalTokens: body.original_tokens,
      compressedTokens: body.compressed_tokens,
    };
  } catch (cause) {
    log("paritok", "compress failed, passing text through", { error: errorText(cause) });
    return { text: content, compressed: false };
  }
}

/** Compresses only what is long enough to be worth a round trip. */
export async function compressIfLong(content: string, query: string) {
  if (content.length < MIN_CHARS) return content;
  return (await compress(content, query)).text;
}

export const sponsor: Sponsor = {
  key: "paritok",
  name: "Paritok",
  role: "Compresses tool outputs and recalled memory before they go back into the model.",
  env: ["PARITOK_API_KEY", "PARITOK_MIN_CHARS"],
  configured: hasParitok,
  status: async (deep) => {
    if (!hasParitok()) return notConfigured("PARITOK_API_KEY not set; text passes through uncompressed");
    if (!deep) return { configured: true, ok: true, detail: `compresses inputs over ${MIN_CHARS} chars; run with --deep to test` };
    return checked(async () => {
      const sample = Array.from({ length: 40 }, (_, i) => `Line ${i}: the table holds ${i % 3} coke cans and ${i % 5} protein bars; nothing else changed.`).join("\n");
      const result = await compress(sample, "how many coke cans are on the table");
      if (!result.compressed) throw new Error("GPU backend unavailable or response had no compressed text");
      return { detail: `${result.originalTokens} → ${result.compressedTokens} tokens on a sample` };
    });
  },
};
