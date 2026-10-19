import type { ObserverId } from "@/lib/types";

// Counted contents of a site (fridge, table, shelf). Pure functions only, so
// the reconciliation that decides "one coke can was taken" is unit-tested
// without a database or a model.

export type Item = { name: string; count: number; since: Date; by: ObserverId };
export type Seen = { name: string; count: number };
/** A change in how many of one item a site holds. `from` 0 is new, `to` 0 is gone. */
export type Delta = { name: string; from: number; to: number };

const MAX_COUNT = 99;
// People and body parts in view are not things kept at a site, whatever the
// model says; counting them makes someone walking past read as a change.
const NOT_A_THING = /^(?:a |the )?(?:person|people|man|woman|boy|girl|child|human|hand|hands|arm|arms|finger|fingers|face|leg|legs)$/;

export const normName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

// Words the model uses interchangeably for the same thing from one look to
// the next. Deliberately short: merging two different items is worse than
// splitting one.
const SYNONYMS: Record<string, string> = {
  soda: "coke",
  cola: "coke",
  pop: "coke",
  "coca-cola": "coke",
  cocacola: "coke",
  tin: "can",
  yoghurt: "yogurt",
  catsup: "ketchup",
};

/** "Cans of Coca Cola" and "soda can" both reduce to "coke can". */
export function itemKey(name: string) {
  const reordered = normName(name)
    .replace(/coca[\s-]cola/g, "coke")
    .replace(/^(.+?)s? of (.+)$/, "$2 $1");
  return reordered
    .split(" ")
    .map((word) => SYNONYMS[word] ?? word)
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .join(" ");
}

/**
 * Reuses a known spelling when the model's name is the same thing said
 * differently ("coke cans", "soda can", "can of coke" vs "coke can"), so the
 * same item is not removed and re-added under another name.
 */
export function canonicalName(name: string, known: string[]) {
  const clean = normName(name);
  if (known.includes(clean)) return clean;
  if (clean.endsWith("s") && known.includes(clean.slice(0, -1))) return clean.slice(0, -1);
  if (known.includes(`${clean}s`)) return `${clean}s`;
  const key = itemKey(clean);
  const same = known.filter((candidate) => itemKey(candidate) === key);
  return same.length === 1 ? same[0] : clean;
}

/** Items stored before counts existed have none; they count as one. */
export function withCounts(items: Partial<Item>[] | undefined): Item[] {
  return (items ?? [])
    .filter(
      (item): item is Partial<Item> & { name: string } =>
        typeof item.name === "string" && !NOT_A_THING.test(normName(item.name)),
    )
    .map((item) => ({
      name: item.name,
      count: Number.isFinite(item.count) && (item.count as number) > 0 ? Math.floor(item.count as number) : 1,
      since: item.since ?? new Date(0),
      by: (item.by ?? "01") as ObserverId,
    }));
}

/**
 * Model output to counted items. Accepts ["milk", "milk"] and
 * [{name, count}] (also "quantity"); merges duplicates by adding their
 * counts; drops empty names and zero counts. Null means "contents not seen".
 */
export function parseInventory(raw: unknown, known: string[] = []): Seen[] | null {
  if (!Array.isArray(raw)) return null;
  const totals = new Map<string, number>();
  for (const entry of raw) {
    let name: unknown;
    let count: unknown = 1;
    if (typeof entry === "string") name = entry;
    else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      name = record.name ?? record.item;
      count = record.count ?? record.quantity ?? 1;
    }
    if (typeof name !== "string" || !normName(name) || NOT_A_THING.test(normName(name))) continue;
    const amount = Math.floor(Number(count));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = canonicalName(name, known);
    totals.set(key, Math.min(MAX_COUNT, (totals.get(key) ?? 0) + amount));
  }
  return [...totals].map(([name, count]) => ({ name, count }));
}

/**
 * What the site holds now, given what it held and what was just seen.
 * An unchanged item keeps who put it there and since when; a changed count
 * records the observer who saw the change; a missing item is dropped.
 */
export function reconcile(current: Item[], seen: Seen[], by: ObserverId, now: Date) {
  const previous = new Map(current.map((item) => [item.name, item]));
  const deltas: Delta[] = [];
  const items: Item[] = [];

  for (const { name, count } of seen) {
    const before = previous.get(name);
    if (!before) {
      items.push({ name, count, since: now, by });
      deltas.push({ name, from: 0, to: count });
    } else if (before.count !== count) {
      items.push({ ...before, count, by });
      deltas.push({ name, from: before.count, to: count });
    } else {
      items.push(before);
    }
  }
  const stillThere = new Set(seen.map((item) => item.name));
  for (const item of current) {
    if (!stillThere.has(item.name)) deltas.push({ name: item.name, from: item.count, to: 0 });
  }
  // Removals first: they are what people ask about ("who took the …").
  deltas.sort((a, b) => Number(a.to > a.from) - Number(b.to > b.from));
  return { items, deltas };
}

/**
 * Target contents when only part of the site was in view. Things out of frame
 * are not gone, so a partial view may only add: a new item, or more of a known
 * one than were known. Counts go down only for removals that were seen
 * happening, and never below what is visibly still there.
 */
export function partialTarget(current: Item[], seen: Seen[], removals: Seen[] = []): Seen[] {
  const visible = new Map(seen.map((item) => [item.name, item.count]));
  const taken = new Map(removals.map((item) => [item.name, item.count]));
  const target: Seen[] = [];
  for (const item of current) {
    const afterRemoval = Math.max(0, item.count - (taken.get(item.name) ?? 0));
    const count = Math.max(afterRemoval, visible.get(item.name) ?? 0);
    if (count > 0) target.push({ name: item.name, count });
  }
  const knownNames = new Set(current.map((item) => item.name));
  for (const item of seen) if (!knownNames.has(item.name)) target.push(item);
  return target;
}

/** "-1 coke can (3→2)", "+2 milk", "-1 mustard". */
export function formatDelta({ name, from, to }: Delta) {
  const diff = to - from;
  const sign = diff > 0 ? "+" : "-";
  const partial = from > 0 && to > 0 ? ` (${from}→${to})` : "";
  return `${sign}${Math.abs(diff)} ${name}${partial}`;
}

/** "coke can ×2, mustard" or "empty". */
export function formatItems(items: Pick<Item, "name" | "count">[]) {
  if (items.length === 0) return "empty";
  return items.map((item) => (item.count > 1 ? `${item.name} ×${item.count}` : item.name)).join(", ");
}

/** Total number of things, counting each can. */
export const totalCount = (items: Pick<Item, "count">[]) =>
  items.reduce((sum, item) => sum + item.count, 0);
