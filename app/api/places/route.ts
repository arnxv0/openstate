import { connection } from "next/server";
import { COLLECTIONS } from "@/lib/db-schema";
import { formatClock } from "@/lib/events-repo";
import { log } from "@/lib/log";
import { db } from "@/lib/mongo";

const jpeg = (image: string) => (image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`);
const stamp = (date: Date) =>
  `${new Date(date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${formatClock(new Date(date))}`;

// Every tracked place with the pictures OPENSTATE holds for it: the
// reference photos used to tell it apart from other places, the saved visual
// anchor (embeddings of views, which start capture when matched) and the
// frames of its most recent episodes.
export async function GET() {
  await connection();
  try {
    const database = await db();
    const entities = database.collection(COLLECTIONS.entities);
    const [sites, anchors] = await Promise.all([
      entities.find({ kind: "container" }).sort({ lastSeen: -1 }).toArray(),
      entities
        .find({ kind: "anchor" }, { projection: { key: 1, name: 1, container: 1, updatedAt: 1, "references.hash": 1 } })
        .toArray(),
    ]);

    const places = await Promise.all(
      sites.map(async (site) => {
        const episodes = await database
          .collection(COLLECTIONS.episodes)
          .find(
            { container: site.name },
            { projection: { observerId: 1, trigger: 1, startedAt: 1, changes: 1, frameHashes: 1, tokens: 1, identityConfidence: 1 } },
          )
          .sort({ startedAt: -1 })
          .limit(12)
          .toArray();
        // Which frames still exist (they expire after 24 hours); the images
        // themselves are fetched one by one from /api/frames/<hash>.
        const hashes = [...new Set(episodes.flatMap((episode) => (episode.frameHashes ?? []) as string[]))];
        const kept = new Set(
          (
            await database
              .collection(COLLECTIONS.frames)
              .find({ hash: { $in: hashes } }, { projection: { hash: 1 } })
              .toArray()
          ).map((frame) => frame.hash as string),
        );
        const siteEvents = await database
          .collection(COLLECTIONS.events)
          .find(
            {
              $or: [
                { location: site.name },
                { "metadata.from": site.name },
                { "metadata.to": site.name },
                { "metadata.object": site.name },
                { title: { $regex: `^${String(site.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ` } },
              ],
            },
            { projection: { ts: 1, type: 1, title: 1, observerId: 1, summary: 1, metadata: 1 } },
          )
          .sort({ ts: -1 })
          .limit(60)
          .toArray();
        const anchor = anchors.find(
          (candidate) => candidate.container === site.name || candidate.name === site.name,
        );
        return {
          name: site.name as string,
          place: (site.place as string | undefined) ?? null,
          catalogued: site.catalogued !== false,
          items: ((site.items ?? []) as { name: string; count?: number }[]).map((item) => ({
            name: item.name,
            count: item.count ?? 1,
          })),
          lastSeen: stamp(site.lastSeen as Date),
          lastObserver: site.lastObserver as string,
          references: ((site.references ?? []) as { image: string; at: Date; observerId: string }[]).map(
            (reference) => ({
              image: jpeg(reference.image),
              at: stamp(reference.at),
              observerId: reference.observerId,
            }),
          ),
          anchor: anchor
            ? { name: anchor.name as string, views: (anchor.references as unknown[]).length, updatedAt: stamp(anchor.updatedAt as Date) }
            : null,
          // Everything recorded about this place, oldest first, for the
          // timeline and the log: what was seen, what changed and who did it.
          log: siteEvents.reverse().map((event) => ({
            id: event._id.toHexString(),
            ts: (event.ts as Date).getTime(),
            at: stamp(event.ts as Date),
            type: event.type as string,
            kind:
              event.type === "transition"
                ? event.title === "Added"
                  ? "added"
                  : "removed"
                : event.type === "system"
                  ? "look"
                  : (event.type as string),
            observerId: (event.observerId as string | undefined) ?? null,
            text: (event.type === "system" ? event.title : event.summary) as string,
          })),
          episodes: episodes.map((episode) => ({
            ts: (episode.startedAt as Date).getTime(),
            id: episode._id.toHexString(),
            at: stamp(episode.startedAt as Date),
            observerId: episode.observerId as string,
            trigger: episode.trigger as string,
            changes: (episode.changes ?? []) as string[],
            tokens: (episode.tokens as number | undefined) ?? 0,
            frames: [...new Set((episode.frameHashes ?? []) as string[])]
              .filter((hash) => kept.has(hash))
              .map((hash) => `/api/frames/${hash}`),
          })),
        };
      }),
    );

    const used = new Set(places.map((place) => place.anchor?.name).filter(Boolean));
    return Response.json({
      places,
      // Anchors saved by voice that no episode has tied to a site yet.
      looseAnchors: anchors
        .filter((anchor) => !used.has(anchor.name as string))
        .map((anchor) => ({
          name: anchor.name as string,
          views: (anchor.references as unknown[]).length,
          updatedAt: stamp(anchor.updatedAt as Date),
        })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}

// Removes a tracked place: its state, reference photos, visual anchor,
// episodes and the events recorded about it. Not reversible.
export async function DELETE(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.trim().toLowerCase();
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  try {
    const database = await db();
    const entities = database.collection(COLLECTIONS.entities);
    const site = await entities.findOne({ kind: "container", name });
    if (!site) return Response.json({ error: "no such place" }, { status: 404 });
    const [sites, anchors, episodes, events] = await Promise.all([
      entities.deleteOne({ _id: site._id }),
      entities.deleteMany({ kind: "anchor", $or: [{ name }, { container: name }] }),
      database.collection(COLLECTIONS.episodes).deleteMany({ container: name }),
      database.collection(COLLECTIONS.events).deleteMany({
        $or: [{ location: name }, { "metadata.from": name }, { "metadata.to": name }, { "metadata.object": name }],
      }),
    ]);
    const removed = {
      site: sites.deletedCount,
      anchors: anchors.deletedCount,
      episodes: episodes.deletedCount,
      events: events.deletedCount,
    };
    log("places", "place deleted", { name, ...removed });
    return Response.json({ ok: true, removed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "unknown" }, { status: 500 });
  }
}
