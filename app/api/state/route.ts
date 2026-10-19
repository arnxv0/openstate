import { connection } from "next/server";
import { COLLECTIONS } from "@/lib/db-schema";
import { outstanding } from "@/lib/episode-queue";
import { formatClock } from "@/lib/events-repo";
import { db } from "@/lib/mongo";
import { listContainers } from "@/lib/perception";
import { formatDuration, goingOff, shoppingList } from "@/lib/trends";
import { loadTrends } from "@/lib/trends-repo";

// Everything OPENSTATE currently holds, for the dashboard's memory panel:
// each site and its counted contents, the latest changes, what people asked
// it to remember, and the usage trends worked out from the change history.
export async function GET() {
  await connection();
  try {
    const database = await db();
    const events = database.collection(COLLECTIONS.events);
    const recent = (type: string, limit: number) =>
      events
        .find({ type }, { projection: { ts: 1, title: 1, observerId: 1, summary: 1, message: 1, metadata: 1 } })
        .sort({ ts: -1 })
        .limit(limit)
        .toArray();
    const [sites, trends, changes, facts, anchors] = await Promise.all([
      listContainers(),
      loadTrends().catch(() => []),
      recent("transition", 12),
      recent("memory", 8),
      database.collection(COLLECTIONS.entities).countDocuments({ kind: "anchor" }).catch(() => 0),
    ]);
    return Response.json({
      sites: sites.map((site) => ({
        name: site.name,
        place: site.place ?? null,
        catalogued: site.catalogued !== false,
        items: site.items.map((item) => ({
          name: item.name,
          count: item.count,
          since: formatClock(new Date(item.since)),
          by: item.by,
        })),
        lastSeen: formatClock(new Date(site.lastSeen)),
        lastObserver: site.lastObserver,
        lastChange: site.lastChange
          ? { summary: site.lastChange.summary, by: site.lastChange.by, at: formatClock(new Date(site.lastChange.at)) }
          : null,
      })),
      changes: changes.map((event) => ({
        id: event._id.toHexString(),
        at: formatClock(new Date(event.ts)),
        kind: event.title === "Added" ? "added" : "removed",
        item: event.metadata?.object ?? null,
        // "Arnav" or "probably Arnav" when the frames showed whose hand it
        // was; otherwise only the camera that saw it is known.
        who:
          typeof event.metadata?.to === "string" && !/^(seen by|unknown|observer)/i.test(event.metadata.to) && event.title !== "Added"
            ? event.metadata.to
            : null,
        detail: event.metadata?.detail ?? null,
        observerId: event.observerId ?? null,
        summary: event.summary,
      })),
      facts: facts.map((event) => ({
        id: event._id.toHexString(),
        at: formatClock(new Date(event.ts)),
        observerId: event.observerId ?? null,
        text: event.message ?? event.summary,
      })),
      trends: trends.map((trend) => ({
        item: trend.item,
        site: trend.site,
        inStock: trend.inStock,
        used: trend.used,
        tracked: formatDuration(trend.trackedMs),
        perDay: trend.perDay === null ? null : Math.round(trend.perDay * 10) / 10,
        runsOutIn: trend.runsOutInMs === null ? null : formatDuration(trend.runsOutInMs),
        freshness: trend.freshness?.status ?? null,
        buy: trend.buy,
      })),
      shoppingList: shoppingList(trends),
      useSoon: goingOff(trends),
      anchors,
      // Episodes the model is reading right now, or that a dashboard has
      // announced: the panel shows a spinner while the state may be changing.
      processing: outstanding(),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
