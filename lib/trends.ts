// Usage trends, shopping suggestions and freshness estimates, worked out from
// the change history OPENSTATE already keeps ("transition" events) and the
// current contents of each site. Pure and dependency-free. Shelf lives come
// from the small table below, or from the web via lib/shelf-life.ts when the
// caller passes what it looked up.

export type Change = {
  item: string;
  site: string;
  from: number;
  to: number;
  at: Date;
  by?: string;
};

export type Stock = { site: string; name: string; count: number; since?: Date };

export type Freshness = {
  shelfLifeDays: number;
  ageDays: number;
  status: "fresh" | "use soon" | "likely past its best";
};

export type ItemTrend = {
  item: string;
  site: string;
  inStock: number;
  /** Units taken and added within the window. */
  used: number;
  added: number;
  /** How long this item has been tracked within the window. */
  trackedMs: number;
  /** Units per day at the observed pace, or null when none were used. */
  perDay: number | null;
  /** Time until the stock runs out at that pace, or null when unknown. */
  runsOutInMs: number | null;
  lastTaken: { at: Date; by?: string } | null;
  freshness: Freshness | null;
  buy: "out" | "running low" | null;
};

type TransitionEvent = {
  ts: Date;
  title?: string;
  observerId?: string;
  metadata?: { object?: string; from?: string; to?: string; detail?: string };
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const key = (site: string, item: string) => `${site.toLowerCase()}\u0000${item.toLowerCase()}`;

/** Reads one stored "Taken" / "Gone from" / "Added" event; null for anything else. */
export function parseChange(event: TransitionEvent): Change | null {
  const meta = event.metadata;
  const counts = /^(\d+)\s*→\s*(\d+)$/.exec(meta?.detail?.trim() ?? "");
  if (!meta?.object || !counts) return null;
  const site = event.title === "Added" ? meta.to : meta.from;
  if (!site) return null;
  return {
    item: meta.object,
    site,
    from: Number(counts[1]),
    to: Number(counts[2]),
    at: new Date(event.ts),
    by: event.observerId,
  };
}

// Typical life once opened or brought home, in days. A guess from the kind of
// item, counted from when OPENSTATE first saw it, not from a printed date.
const SHELF_LIFE: [RegExp, number][] = [
  [/chicken|beef|pork|fish|meat|mince|sausage/, 3],
  [/leftover|cooked|takeaway|pizza/, 4],
  [/strawberr|raspberr|blueberr|berries|berry/, 5],
  [/bread|bagel|bun/, 5],
  [/lettuce|spinach|salad|herb|cucumber|tomato|avocado|banana/, 7],
  [/milk|cream(?!\s*cheese)/, 7],
  [/juice/, 10],
  [/yogh?urt/, 14],
  [/cheese/, 21],
  [/egg/, 28],
  [/apple|orange|lemon|lime|carrot|onion|potato/, 28],
  [/butter|margarine/, 60],
  [/mustard|ketchup|mayo|sauce|jam|pickle|dressing/, 180],
];

// Belongings get taken and put back; that is not consumption, so they are
// never something to buy.
const BELONGING =
  /laptop|computer|phone|tablet|charger|cable|bag|backpack|pillow|cushion|book|notebook|key|wallet|remote|glasses|headphone|jacket|coat|umbrella|camera|mouse|keyboard|monitor|pen\b|pencil/;

export const isBelonging = (item: string) => BELONGING.test(item.toLowerCase());

export function shelfLifeDays(item: string): number | null {
  const name = item.toLowerCase();
  return SHELF_LIFE.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

export function freshness(
  item: string,
  since: Date | undefined,
  now: Date,
  /** Shelf life looked up on the web, which beats the built-in table. */
  lookedUp?: number | null,
): Freshness | null {
  const shelfLife = lookedUp ?? shelfLifeDays(item);
  if (shelfLife === null || !since) return null;
  const ageDays = Math.max(0, (now.getTime() - new Date(since).getTime()) / DAY);
  const status =
    ageDays > shelfLife ? "likely past its best" : ageDays > shelfLife * 0.7 ? "use soon" : "fresh";
  return { shelfLifeDays: shelfLife, ageDays: Math.round(ageDays * 10) / 10, status };
}

/**
 * One trend per item per site: what is there, how fast it goes, when it runs
 * out and whether to buy more. Items that are gone but were used in the window
 * are kept, since those are the ones to restock.
 */
export function computeTrends(
  changes: Change[],
  stock: Stock[],
  now: Date,
  windowDays = 14,
  /** Shelf lives looked up on the web, by lowercase item name. */
  shelfLives?: Map<string, number>,
): ItemTrend[] {
  const start = now.getTime() - windowDays * DAY;
  const recent = changes
    .filter((change) => change.at.getTime() >= start && change.at.getTime() <= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const rows = new Map<string, { item: string; site: string; stock?: Stock; changes: Change[] }>();
  for (const entry of stock) {
    rows.set(key(entry.site, entry.name), { item: entry.name, site: entry.site, stock: entry, changes: [] });
  }
  for (const change of recent) {
    const id = key(change.site, change.item);
    const row = rows.get(id) ?? { item: change.item, site: change.site, changes: [] };
    row.changes.push(change);
    rows.set(id, row);
  }

  const trends = [...rows.values()].map(({ item, site, stock: entry, changes: own }): ItemTrend => {
    const inStock = entry?.count ?? 0;
    let used = 0;
    let added = 0;
    let lastTaken: ItemTrend["lastTaken"] = null;
    for (const change of own) {
      if (change.to < change.from) {
        used += change.from - change.to;
        lastTaken = { at: change.at, by: change.by };
      } else {
        added += change.to - change.from;
      }
    }
    const firstSeen = Math.min(
      own[0]?.at.getTime() ?? Infinity,
      entry?.since ? new Date(entry.since).getTime() : Infinity,
    );
    // A floor of an hour stops one quick removal from reading as hundreds a day.
    const trackedMs = Math.max(HOUR, now.getTime() - Math.max(start, Math.min(firstSeen, now.getTime())));
    const perDay = used > 0 && !isBelonging(item) ? (used / trackedMs) * DAY : null;
    const runsOutInMs = perDay && inStock > 0 ? (inStock / perDay) * DAY : null;
    const buy = isBelonging(item)
      ? null
      : inStock === 0 && used > 0
        ? "out"
        : runsOutInMs !== null && runsOutInMs < 2 * DAY
          ? "running low"
          : null;
    return {
      item,
      site,
      inStock,
      used,
      added,
      trackedMs,
      perDay,
      runsOutInMs,
      lastTaken,
      freshness: inStock > 0 ? freshness(item, entry?.since, now, shelfLives?.get(item.toLowerCase())) : null,
      buy,
    };
  });

  const urgency = (trend: ItemTrend) => (trend.buy === "out" ? 0 : trend.buy ? 1 : 2);
  return trends.sort((a, b) => urgency(a) - urgency(b) || b.used - a.used || a.item.localeCompare(b.item));
}

export function formatDuration(ms: number) {
  if (ms < 90 * 60_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 36 * HOUR) return `${Math.round(ms / HOUR)} hours`;
  return `${Math.round(ms / DAY)} days`;
}

const round = (value: number) => (value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);

export function formatTrend(trend: ItemTrend, clock: (date: Date) => string = (d) => d.toISOString()) {
  if (isBelonging(trend.item)) {
    // A belonging has no pace or stock to run out of, only a last sighting.
    const taken = trend.lastTaken
      ? `; last picked up ${clock(trend.lastTaken.at)}${trend.lastTaken.by ? `, seen by observer ${trend.lastTaken.by}` : ""}`
      : "";
    return `- ${trend.item} (${trend.site}): ${trend.inStock} there now${taken}; a belonging, not something to buy`;
  }
  const parts = [`${trend.inStock} in stock`];
  if (trend.used > 0) {
    parts.push(`${trend.used} used over ${formatDuration(trend.trackedMs)} (about ${round(trend.perDay ?? 0)} a day)`);
  } else {
    parts.push(`none used over ${formatDuration(trend.trackedMs)}`);
  }
  if (trend.added > 0) parts.push(`${trend.added} added`);
  if (trend.runsOutInMs !== null) parts.push(`runs out in about ${formatDuration(trend.runsOutInMs)} at this pace`);
  if (trend.lastTaken) {
    parts.push(`last taken ${clock(trend.lastTaken.at)}${trend.lastTaken.by ? ` by observer ${trend.lastTaken.by}` : ""}`);
  }
  if (trend.freshness) {
    parts.push(
      `${trend.freshness.status}: here ${trend.freshness.ageDays} days, usually keeps about ${trend.freshness.shelfLifeDays}`,
    );
  }
  if (trend.buy) parts.push(trend.buy === "out" ? "BUY: none left" : "BUY: running low");
  return `- ${trend.item} (${trend.site}): ${parts.join("; ")}`;
}

export function formatTrends(trends: ItemTrend[], clock?: (date: Date) => string) {
  if (trends.length === 0) return "- no usage history yet";
  return trends.map((trend) => formatTrend(trend, clock)).join("\n");
}

/** What to buy, most urgent first. */
export function shoppingList(trends: ItemTrend[]) {
  return trends
    .filter((trend) => trend.buy)
    .map((trend) => ({ item: trend.item, site: trend.site, reason: trend.buy as string, perDay: trend.perDay }));
}

/** Things to use up or check, soonest first. */
export function goingOff(trends: ItemTrend[]) {
  return trends
    .filter((trend) => trend.freshness && trend.freshness.status !== "fresh")
    .sort((a, b) => b.freshness!.ageDays / b.freshness!.shelfLifeDays - a.freshness!.ageDays / a.freshness!.shelfLifeDays)
    .map((trend) => ({ item: trend.item, site: trend.site, ...trend.freshness! }));
}
