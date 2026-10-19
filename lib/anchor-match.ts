// Matching a live frame's embeddings against saved anchors. Pure: no browser
// APIs, so the thresholds that decide when capture starts are unit-tested.

export type AnchorReference = { embedding: number[]; hash: string };
export type Anchor = { key: string; name: string; container: string; references: AnchorReference[] };
export type AnchorMatch = { anchor: Anchor; similarity: number };

// Cosine similarity to a saved anchor's reference views. Measured with the
// MobileNetV3-small embedder on two handheld scans of the same fridge taken
// minutes apart: frames of the later scan scored 0.69-0.90 against a bank
// built from the first 3 s of the earlier one (median 0.84), while the same
// kitchen's counter scored 0.34, a tight crop of the door shelves 0.42, and
// an inverted copy 0.45. Enter sits in the middle of that gap; exit is lower
// so a capture in progress survives brief dips (hand in frame, exposure).
export const MATCH_ENTER = 0.7;
export const MATCH_EXIT = 0.6;

/** Cosine similarity; embeddings are L2-normalised so this is a dot product. */
export function cosine(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** Best anchor for any of the frame's embedding variants, or null if none saved. */
export function bestMatch(anchors: Anchor[], variants: number[][]): AnchorMatch | null {
  let best: AnchorMatch | null = null;
  for (const anchor of anchors) {
    for (const reference of anchor.references) {
      for (const embedding of variants) {
        const similarity = cosine(embedding, reference.embedding);
        if (!best || similarity > best.similarity) best = { anchor, similarity };
      }
    }
  }
  return best;
}

/**
 * Hysteresis: starting a capture needs MATCH_ENTER; once an anchored capture
 * is running it continues down to MATCH_EXIT.
 */
export function anchorSeen(match: AnchorMatch | null, capturingAnchor: boolean) {
  return Boolean(match && match.similarity >= (capturingAnchor ? MATCH_EXIT : MATCH_ENTER));
}

/** The anchor seen most often in the trigger window. */
export function dominantAnchor(recent: (Anchor | null)[]) {
  const counts = new Map<string, { anchor: Anchor; hits: number }>();
  for (const anchor of recent) {
    if (!anchor) continue;
    const entry = counts.get(anchor.key) ?? { anchor, hits: 0 };
    entry.hits += 1;
    counts.set(anchor.key, entry);
  }
  return [...counts.values()].sort((a, b) => b.hits - a.hits)[0]?.anchor ?? null;
}
