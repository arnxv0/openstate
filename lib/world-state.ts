import { formatItems, totalCount, type Item } from "@/lib/inventory";

// The authoritative "what is where right now" block handed to the answer
// model. Pure, so the exact text a question is answered from is tested.

export type SiteState = {
  name: string;
  place?: string;
  items: Item[];
  catalogued?: boolean;
  lastSeen: Date;
  lastObserver: string;
  lastChange?: { summary: string; by: string; at: Date };
};

// Times from an earlier day carry the day, so "21:12 yesterday" is not read
// as later than "15:46 today".
const defaultClock = (date: Date) => {
  const time = date.toLocaleTimeString("en-GB");
  if (date.toDateString() === new Date().toDateString()) return `${time} today`;
  return `${time} on ${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
};

export function formatSite(site: SiteState, clock: (date: Date) => string = defaultClock) {
  const where = site.place ? ` (${site.place})` : "";
  const checked = `last checked ${clock(site.lastSeen)} by observer ${site.lastObserver}`;
  if (site.catalogued === false) return `- ${site.name}${where}: contents not seen yet; ${checked}`;
  const contents = site.items.length
    ? site.items
        .map((item) => `${formatItems([item])} [since ${clock(item.since)}, last touched by observer ${item.by}]`)
        .join(", ")
    : "empty";
  const total = site.items.length ? `; ${totalCount(site.items)} things in total` : "";
  const change = site.lastChange
    ? `; last change: ${site.lastChange.summary} seen by observer ${site.lastChange.by} at ${clock(site.lastChange.at)}`
    : "";
  return `- ${site.name}${where}: ${contents}${total}; ${checked}${change}`;
}

export function formatWorldState(sites: SiteState[], clock?: (date: Date) => string) {
  if (sites.length === 0) return "- nothing catalogued yet";
  return sites.map((site) => formatSite(site, clock)).join("\n");
}
