import { COLLECTIONS } from "@/lib/db-schema";
import { db } from "@/lib/mongo";

// A running estimate of model spend. Every model call made by this app is
// recorded with its token counts; cost is tokens times a price table. It is
// an estimate: the provider's billing page is the authority, and calls made
// inside the deployed Agent Engine agent are not seen here.

// USD per million tokens (input, output). Override the default with
// LLM_PRICE_INPUT / LLM_PRICE_OUTPUT if the provider's prices differ.
const PRICES: [RegExp, number, number][] = [
  [/^gpt-5\.4-mini/, 0.75, 4.5],
  [/^gpt-4\.1-mini/, 0.4, 1.6],
  [/^gpt-4\.1-nano|^gpt-5.*nano/, 0.1, 0.4],
  [/^gemini/, 0, 0],
  [/^groq:/, 0, 0],
];
const DEFAULT_PRICE: [number, number] = [
  Number(process.env.LLM_PRICE_INPUT ?? 0.75),
  Number(process.env.LLM_PRICE_OUTPUT ?? 4.5),
];

export function costUsd(model: string, input: number, output: number) {
  const override = process.env.LLM_PRICE_INPUT || process.env.LLM_PRICE_OUTPUT;
  const row = override ? undefined : PRICES.find(([pattern]) => pattern.test(model));
  const [inPrice, outPrice] = row ? [row[1], row[2]] : DEFAULT_PRICE;
  return (input * inPrice + output * outPrice) / 1_000_000;
}

/** Best-effort: a failed write must never fail the model call it describes. */
export function recordUsage(model: string, usage: { input: number; output: number }) {
  void (async () => {
    try {
      await (await db()).collection(COLLECTIONS.metrics).insertOne({
        ts: new Date(),
        meta: { kind: "llm", model },
        input: usage.input,
        output: usage.output,
      });
    } catch (cause) {
      console.warn(`[usage] not recorded: ${cause instanceof Error ? cause.message : cause}`);
    }
  })();
}

export type UsageTotals = { calls: number; input: number; output: number; usd: number };

export function addUsage(rows: { model: string; calls: number; input: number; output: number }[]): UsageTotals {
  return rows.reduce(
    (total, row) => ({
      calls: total.calls + row.calls,
      input: total.input + row.input,
      output: total.output + row.output,
      usd: total.usd + costUsd(row.model, row.input, row.output),
    }),
    { calls: 0, input: 0, output: 0, usd: 0 },
  );
}

async function totalsSince(since: Date) {
  const rows = await (await db())
    .collection(COLLECTIONS.metrics)
    .aggregate<{ _id: string; calls: number; input: number; output: number }>([
      { $match: { "meta.kind": "llm", ts: { $gte: since } } },
      { $group: { _id: "$meta.model", calls: { $sum: 1 }, input: { $sum: "$input" }, output: { $sum: "$output" } } },
    ])
    .toArray();
  return rows.map(({ _id, ...rest }) => ({ model: _id, ...rest }));
}

export async function usageSummary(now = new Date()) {
  const [hour, day, all] = await Promise.all([
    totalsSince(new Date(now.getTime() - 3_600_000)),
    totalsSince(new Date(now.getTime() - 24 * 3_600_000)),
    totalsSince(new Date(0)),
  ]);
  return {
    lastHour: addUsage(hour),
    last24h: addUsage(day),
    total: addUsage(all),
    byModel: all.map((row) => ({ ...row, usd: costUsd(row.model, row.input, row.output) })),
  };
}
