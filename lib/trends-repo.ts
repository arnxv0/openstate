import { COLLECTIONS } from "@/lib/db-schema";
import { db } from "@/lib/mongo";
import { listContainers } from "@/lib/perception";
import { computeTrends, parseChange, type Change, type Stock } from "@/lib/trends";

/** Usage trends for every tracked item, from stored changes and current contents. */
export async function loadTrends(windowDays = 14, now = new Date()) {
  const since = new Date(now.getTime() - windowDays * 86_400_000);
  const [events, sites] = await Promise.all([
    (await db())
      .collection(COLLECTIONS.events)
      .find({ type: "transition", ts: { $gte: since } }, { projection: { ts: 1, title: 1, observerId: 1, metadata: 1 } })
      .sort({ ts: 1 })
      .limit(2000)
      .toArray(),
    listContainers(),
  ]);
  const changes = events.map((event) => parseChange(event as never)).filter((c): c is Change => c !== null);
  const stock: Stock[] = sites.flatMap((site) =>
    site.items.map((item) => ({ site: site.name, name: item.name, count: item.count, since: item.since })),
  );
  return computeTrends(changes, stock, now, windowDays);
}
