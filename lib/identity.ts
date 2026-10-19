// Which registered site an episode shows, from the model's answer. Pure, so
// the rules that stop two similar fridges (or tables) being merged are tested.

export const LETTERS = "ABCDEF";
const MIN_CONFIDENCE = 0.5;

export type Verdict =
  | { kind: "known"; index: number; confidence: number }
  | { kind: "new"; confidence: number }
  | { kind: "unsure"; confidence: number };

/**
 * - A lite fallback model is never trusted with identity: it may create the
 *   very first site, otherwise the episode stays unresolved.
 * - A candidate letter needs confidence >= 0.5 and must exist.
 * - "new" needs confidence >= 0.5, except when nothing is registered yet.
 */
export function resolveIdentity({
  identity,
  confidence,
  trusted,
  candidates,
}: {
  identity: string | null | undefined;
  confidence: number | null | undefined;
  trusted: boolean;
  candidates: number;
}): Verdict {
  if (candidates === 0) return { kind: "new", confidence: trusted ? (confidence ?? 0.5) : 0 };
  if (!trusted) return { kind: "unsure", confidence: 0 };
  const score = confidence ?? 0.5;
  const answer = identity?.trim() ?? "";
  if (score >= MIN_CONFIDENCE) {
    if (answer.length === 1) {
      const index = LETTERS.indexOf(answer.toUpperCase());
      if (index >= 0 && index < candidates) return { kind: "known", index, confidence: score };
    }
    if (answer.toLowerCase() === "new") return { kind: "new", confidence: score };
  }
  return { kind: "unsure", confidence: score };
}

/** "table", "table 2", "table 3" … for a second site of the same kind. */
export function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base} ${n}`)) return `${base} ${n}`;
}
