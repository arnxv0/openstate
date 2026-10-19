import type { WithId } from "mongodb";
import { COLLECTIONS } from "@/lib/db-schema";
import { db } from "@/lib/mongo";
import type { ObserverId } from "@/lib/types";

// Long-term memory, on Atlas. OPENSTATE's own collections stay the source of
// truth for container state; this is the cross-session layer that outlives
// any one conversation: voice turns, explicit "remember" facts, perception
// episodes and the household's vocabulary of places. One `memories`
// collection holds all four kinds; Atlas auto-embeds `text` (voyage-4) and a
// hybrid $rankFusion query recalls what fits a question. Every call here is
// best-effort: a failure is logged and the app carries on.

export type MemoryKind = "turn" | "fact" | "episode" | "term";

export type MemoryDoc = {
  kind: MemoryKind;
  /** What is embedded and searched. */
  text: string;
  /** Fact label, episode title or term name; facts and terms upsert on it. */
  label?: string;
  observerId?: ObserverId;
  role?: "user" | "assistant" | "system";
  /** Conversation session a turn belongs to (one per observer per day). */
  session?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  ts: Date;
  updatedAt?: Date;
};

const RECALLABLE: MemoryKind[] = ["fact", "episode", "term"];
const APPROX_CHARS_PER_TOKEN = 4;

export const slug = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** One conversation session per observer per day keeps short-term memory coherent. */
export const observerSession = (observerId: ObserverId) =>
  `observer-${observerId}-${new Date().toISOString().slice(0, 10)}`;

async function memories() {
  return (await db()).collection<MemoryDoc>(COLLECTIONS.memories);
}

async function attempt<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (cause) {
    console.warn(`[memory] ${what} failed: ${cause instanceof Error ? cause.message : cause}`);
    return null;
  }
}

/** Short-term memory: one conversation turn of an observer. */
export function recordTurn({
  observerId,
  role,
  content,
  modelName,
}: {
  observerId: ObserverId;
  role: "user" | "assistant" | "system";
  content: string;
  modelName?: string;
}) {
  return attempt("recordTurn", async () =>
    (await memories()).insertOne({
      kind: "turn",
      text: content,
      observerId,
      role,
      session: observerSession(observerId),
      metadata: modelName ? { modelName } : undefined,
      ts: new Date(),
    }),
  );
}

/** Semantic memory: a standalone fact ("the garage fridge is in the garage"). */
export function rememberFact({
  label,
  text,
  observerId,
  metadata,
}: {
  label: string;
  text: string;
  observerId: ObserverId;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date();
  return attempt("rememberFact", async () =>
    (await memories()).updateOne(
      { kind: "fact", label: slug(label) },
      {
        $set: { text, observerId, metadata: { observerId, ...metadata }, updatedAt: now },
        $setOnInsert: { ts: now },
      },
      { upsert: true },
    ),
  );
}

/** Episodic memory: what happened during one perception episode. */
export function rememberEpisode({
  title,
  content,
  summary,
  observerId,
  tags,
  metadata,
}: {
  title: string;
  content: string;
  summary?: string;
  observerId: ObserverId;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  return attempt("rememberEpisode", async () =>
    (await memories()).insertOne({
      kind: "episode",
      label: title,
      text: content,
      observerId,
      session: observerSession(observerId),
      tags,
      metadata: { observerId, summary, ...metadata },
      ts: new Date(),
    }),
  );
}

/** Taxonomic memory: the household's vocabulary of places and containers. */
export function defineTerm({
  term,
  definition,
  relatedTerms,
}: {
  term: string;
  definition: string;
  relatedTerms?: string[];
}) {
  const now = new Date();
  return attempt("defineTerm", async () =>
    (await memories()).updateOne(
      { kind: "term", label: term.toLowerCase() },
      {
        $set: { text: `${term}: ${definition}`, metadata: { relatedTerms: relatedTerms ?? [] }, updatedAt: now },
        $setOnInsert: { ts: now },
      },
      { upsert: true },
    ),
  );
}

export type RecalledContext = {
  text: string;
  counts: Record<string, number>;
  tokens: number;
  mode: "hybrid" | "vector" | "recent";
};

const when = (doc: MemoryDoc) => (doc.updatedAt ?? doc.ts).toISOString().slice(0, 16).replace("T", " ");

/**
 * Prompt-ready text from recalled memories and the observer's recent turns,
 * grouped by kind and cut to a character budget. Pure, so it can be tested.
 */
export function formatRecalled(docs: MemoryDoc[], turns: MemoryDoc[], maxChars: number) {
  const byKind = (kind: MemoryKind) => docs.filter((doc) => doc.kind === kind);
  const sections: [string, string[]][] = [
    ["Facts people asked to remember:", byKind("fact").map((d) => `- [${when(d)}] ${d.text}`)],
    ["Past sightings:", byKind("episode").map((d) => `- [${when(d)}] ${d.text}`)],
    ["Places and containers:", byKind("term").map((d) => `- ${d.text}`)],
    [
      "Earlier in this observer's conversation today:",
      turns.map((d) => `- ${d.role === "assistant" ? "OPENSTATE" : "They"}: ${d.text}`),
    ],
  ];
  const lines: string[] = [];
  let used = 0;
  for (const [heading, items] of sections) {
    if (items.length === 0) continue;
    const block = [heading, ...items];
    for (const line of block) {
      if (used + line.length + 1 > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
  }
  return lines.join("\n");
}

/** Long-term context for a question: facts, sightings and vocabulary that fit it, plus today's turns. */
export function recallContext(query: string, observerId: ObserverId, maxTokens = 1200, limit = 8) {
  return attempt<RecalledContext | null>("recallContext", async () => {
    const collection = await memories();
    const vector = {
      $vectorSearch: {
        index: "memories_semantic",
        path: "text",
        query,
        numCandidates: 100,
        limit: limit * 2,
        filter: { kind: { $in: RECALLABLE } },
      },
    };
    let mode: RecalledContext["mode"] = "hybrid";
    let docs: WithId<MemoryDoc>[] = [];
    try {
      docs = await collection
        .aggregate<WithId<MemoryDoc>>([
          {
            $rankFusion: {
              input: {
                pipelines: {
                  vector: [vector],
                  text: [
                    { $search: { index: "memories_text", text: { query, path: ["text", "label"] } } },
                    { $match: { kind: { $in: RECALLABLE } } },
                    { $limit: limit * 2 },
                  ],
                },
              },
              combination: { weights: { vector: 0.7, text: 0.3 } },
            },
          },
          { $limit: limit },
        ])
        .toArray();
    } catch {
      mode = "vector";
      try {
        docs = await collection.aggregate<WithId<MemoryDoc>>([vector, { $limit: limit }]).toArray();
      } catch {
        // Search indexes still building: fall back to the newest records.
        mode = "recent";
        docs = await collection.find({ kind: { $in: RECALLABLE } }).sort({ ts: -1 }).limit(limit).toArray();
      }
    }
    const turns = (
      await collection
        .find({ kind: "turn", session: observerSession(observerId) })
        .sort({ ts: -1 })
        .limit(6)
        .toArray()
    ).reverse();
    const text = formatRecalled(docs, turns, maxTokens * APPROX_CHARS_PER_TOKEN);
    if (!text.trim()) return null;
    const counts: Record<string, number> = {};
    for (const doc of docs) counts[doc.kind] = (counts[doc.kind] ?? 0) + 1;
    if (turns.length) counts.turn = turns.length;
    return { text, counts, tokens: Math.round(text.length / APPROX_CHARS_PER_TOKEN), mode };
  });
}

/** Memories matching a query, for the agent's recall tool. */
export async function searchMemories(query: string, limit = 6) {
  const recalled = await recallContext(query, "01", 800, limit);
  return recalled?.text ?? "";
}

/** Counts by kind and search-index state, for /api/health. */
export async function memoryStatus() {
  const started = performance.now();
  try {
    const collection = await memories();
    const [counts, indexes] = await Promise.all([
      collection.aggregate<{ _id: MemoryKind; n: number }>([{ $group: { _id: "$kind", n: { $sum: 1 } } }]).toArray(),
      collection.listSearchIndexes().toArray() as Promise<{ name: string; status?: string }[]>,
    ]);
    return {
      ok: true as const,
      counts: Object.fromEntries(counts.map((row) => [row._id, row.n])),
      searchIndexes: indexes.map((index) => ({ name: index.name, status: index.status })),
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (cause) {
    return { ok: false as const, error: cause instanceof Error ? cause.message.slice(0, 200) : String(cause) };
  }
}
