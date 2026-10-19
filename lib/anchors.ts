import { COLLECTIONS } from "@/lib/db-schema";
import { insertEvent } from "@/lib/events-repo";
import { db } from "@/lib/mongo";
import type { ObserverId } from "@/lib/types";

// A visual anchor is a place or object a person asked OPENSTATE to remember
// ("Hey World, remember this fridge"). Dashboards embed a few reference views
// of it with an on-device image embedder; from then on every live frame is
// compared against these references and capture only starts on a match.

export const MAX_REFERENCES = 24;
export const EMBEDDING_DIMS = 1024;

export type AnchorReference = {
  embedding: number[];
  hash: string;
  observerId: ObserverId;
  at: Date;
};

export type AnchorDoc = {
  key: string;
  kind: "anchor";
  name: string;
  /** Container name used by perception for inventory reconciliation. */
  container: string;
  description: string;
  references: AnchorReference[];
  observerId: ObserverId;
  createdAt: Date;
  updatedAt: Date;
};

export type AnchorSummary = Pick<AnchorDoc, "key" | "name" | "container"> & {
  references: Pick<AnchorReference, "embedding" | "hash">[];
  updatedAt: Date;
};

const slug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/^(the|my|our|this|that)\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

export const anchorKey = (name: string) => `anchor:${slug(name)}`;

async function collection() {
  return (await db()).collection<AnchorDoc>(COLLECTIONS.entities);
}

export async function listAnchors(): Promise<AnchorSummary[]> {
  const docs = await (await collection())
    .find({ kind: "anchor" })
    .sort({ updatedAt: -1 })
    .toArray();
  return docs.map((doc) => ({
    key: doc.key,
    name: doc.name,
    container: doc.container,
    updatedAt: doc.updatedAt,
    references: doc.references.map(({ embedding, hash }) => ({ embedding, hash })),
  }));
}

export async function saveAnchor({
  name,
  observerId,
  references,
}: {
  name: string;
  observerId: ObserverId;
  references: { embedding: number[]; hash: string }[];
}) {
  const container = slug(name).replace(/-/g, " ") || "anchor";
  const key = anchorKey(name);
  const now = new Date();
  const incoming = references.map((ref) => ({ ...ref, observerId, at: now }));
  const anchors = await collection();
  const existing = await anchors.findOne({ key });

  const merged = [...(existing?.references ?? []), ...incoming].slice(-MAX_REFERENCES);
  const description = `Saved visual anchor "${container}" with ${merged.length} reference views, first remembered by observer ${existing?.observerId ?? observerId}.`;
  await anchors.updateOne(
    { key },
    {
      $set: { references: merged, description, updatedAt: now },
      $setOnInsert: {
        key,
        kind: "anchor",
        name: container,
        container,
        observerId,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  await insertEvent({
    type: "memory",
    observerId,
    title: existing ? "Anchor updated" : "Anchor saved",
    message: `${container} · ${incoming.length} new reference view${incoming.length === 1 ? "" : "s"} · ${merged.length} total`,
    metadata: { anchor: key, object: container },
    summary: `${existing ? "Updated" : "Saved"} the visual anchor for the ${container}; observer ${observerId} added ${incoming.length} reference views.`,
  });

  return { key, name: container, container, references: merged.length };
}
