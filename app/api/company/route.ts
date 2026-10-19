import { connection } from "next/server";
import { ROSTER, type AgentKey } from "@/lib/company/roster";
import { recent, type Line } from "@/lib/company/transcript";
import { eventsCollection } from "@/lib/events-repo";
import { participantsSummary } from "@/lib/sponsors/band";
import { avatarCards } from "@/lib/sponsors/masky";

// The company as the dashboard shows it: who works here, their Masky faces,
// the BAND room, and the last lines the agents said to each other. The live
// transcript is in memory; after a restart the lines come back from the
// events collection so the panel is never empty for no reason.

const KEYS = new Set<string>(ROSTER.map((profile) => profile.key));

async function fromEvents(limit: number): Promise<Line[]> {
  const docs = await (await eventsCollection()).find({ type: "agent" }).sort({ ts: -1 }).limit(limit).toArray();
  return docs
    .reverse()
    .flatMap((doc) => {
      const from = doc.metadata?.from;
      const to = doc.metadata?.to;
      if (!from || !KEYS.has(from) || !to) return [];
      return [
        {
          id: doc._id.toHexString(),
          at: doc.ts.toISOString(),
          from: from as AgentKey,
          to: (KEYS.has(to) ? to : to === "all" ? "all" : "user") as Line["to"],
          text: doc.message ?? doc.summary,
          tools: doc.metadata?.detail ? doc.metadata.detail.split(", ") : undefined,
          requestId: "history",
        },
      ];
    });
}

export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40));
  const requestId = url.searchParams.get("request") ?? undefined;
  const live = recent(limit, requestId);
  const [avatars, band, transcript] = await Promise.all([
    avatarCards(),
    participantsSummary(),
    live.length || requestId ? Promise.resolve(live) : fromEvents(limit).catch(() => live),
  ]);
  return Response.json({
    roster: ROSTER.map(({ key, name, title, brief, color, tools }) => ({ key, name, title, brief, color, tools })),
    avatars,
    band: { configured: band.configured, roomId: band.roomId, participants: band.participants.length, error: band.error },
    transcript,
  });
}
