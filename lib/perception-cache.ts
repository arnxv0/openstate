import { createHash } from "node:crypto";
import { COLLECTIONS } from "@/lib/db-schema";
import { db } from "@/lib/mongo";

// Perception results keyed by the perceptual hashes of the keyframes that
// produced them. A static phone pointed at a fridge re-triggers an episode
// every ~65s with visually identical frames; those hit here instead of Gemini.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type CacheDoc<T> = {
  key: string;
  promptVersion: string;
  hashes: string[];
  perceived: T;
  model: string;
  hits: number;
  at: Date;
  expireAt: Date;
};

export function cacheKey(promptVersion: string, hashes: string[]) {
  return createHash("sha256")
    .update(`${promptVersion}|${[...hashes].sort().join(",")}`)
    .digest("hex");
}

function usable(hashes: (string | undefined)[]): hashes is string[] {
  return hashes.length > 0 && hashes.every((hash) => typeof hash === "string" && /^[0-9a-f]{16}$/.test(hash));
}

async function collection<T>() {
  return (await db()).collection<CacheDoc<T>>(COLLECTIONS.perceptionCache);
}

/**
 * Exact matches only: a fridge with one carton removed differs from the full
 * fridge by about one bit of dHash, so near-duplicate matching would replay
 * the old inventory.
 */
export async function lookupPerception<T>(
  promptVersion: string,
  hashes: (string | undefined)[],
): Promise<{ perceived: T; model: string } | null> {
  if (!usable(hashes)) return null;
  const cache = await collection<T>();
  const hit = await cache.findOne({ key: cacheKey(promptVersion, hashes) });
  if (!hit) return null;

  await cache.updateOne({ _id: hit._id }, { $inc: { hits: 1 }, $set: { at: new Date() } });
  return { perceived: hit.perceived, model: hit.model };
}

export async function rememberPerception<T>(
  promptVersion: string,
  hashes: (string | undefined)[],
  perceived: T,
  model: string,
) {
  if (!usable(hashes)) return;
  const now = new Date();
  await (await collection<T>()).updateOne(
    { key: cacheKey(promptVersion, hashes) },
    {
      $set: { perceived, model, at: now, expireAt: new Date(now.getTime() + CACHE_TTL_MS) },
      $setOnInsert: { promptVersion, hashes, hits: 0 },
    },
    { upsert: true },
  );
}
