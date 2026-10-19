import { connection } from "next/server";
import { formatDuration, shoppingList, goingOff } from "@/lib/trends";
import { loadTrends } from "@/lib/trends-repo";

// How fast things are used, what to buy and what to use up, worked out from
// the change history. ?days=N sets the window (default 14).
export async function GET(request: Request) {
  await connection();
  const days = Math.min(90, Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 14));
  try {
    const trends = await loadTrends(days);
    return Response.json({
      windowDays: days,
      shoppingList: shoppingList(trends),
      useSoon: goingOff(trends),
      items: trends.map((trend) => ({
        ...trend,
        tracked: formatDuration(trend.trackedMs),
        runsOutIn: trend.runsOutInMs === null ? null : formatDuration(trend.runsOutInMs),
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
