import type { ObjectId, WithId } from "mongodb";
import { COLLECTIONS } from "@/lib/db-schema";
import { db } from "@/lib/mongo";
import type { EventMetadata, ObserverId, WorldEvent } from "@/lib/types";

export type EventDoc = Omit<WorldEvent, "id" | "timestamp"> & {
  _id?: ObjectId;
  ts: Date;
  summary: string;
};

export function formatClock(date: Date) {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

export function toWorldEvent(doc: WithId<EventDoc>): WorldEvent {
  return {
    id: doc._id.toHexString(),
    timestamp: formatClock(doc.ts),
    observerId: doc.observerId,
    type: doc.type,
    title: doc.title,
    message: doc.message,
    location: doc.location,
    confidence: doc.confidence,
    intent: doc.intent,
    metadata: doc.metadata,
  };
}

export async function eventsCollection() {
  return (await db()).collection<EventDoc>(COLLECTIONS.events);
}

export async function insertEvent(input: {
  type: WorldEvent["type"];
  title: string;
  observerId?: ObserverId;
  message?: string;
  intent?: WorldEvent["intent"];
  location?: string[];
  metadata?: EventMetadata;
  summary?: string;
}) {
  const doc: EventDoc = {
    ...input,
    ts: new Date(),
    summary: input.summary ?? input.message ?? input.title,
  };
  const result = await (await eventsCollection()).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function recentEvents(limit = 40) {
  const docs = await (await eventsCollection())
    .find({})
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();
  return docs.reverse().map(toWorldEvent);
}
