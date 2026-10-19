import type { Db, IndexDescription, SearchIndexDescription } from "mongodb";

export const COLLECTIONS = {
  observations: "observations",
  frames: "frames",
  perceptionCache: "perception_cache",
  entities: "entities",
  events: "events",
  zones: "zones",
  privacy: "privacy_windows",
  episodes: "episodes",
  genomes: "genomes",
  edits: "edits",
  evals: "evals",
  metrics: "metrics",
  memories: "memories",
  lookups: "lookups",
} as const;

export type SearchIndexInfo = { name: string; status?: string };

type TimeSeriesSpec = {
  timeField: string;
  metaField: string;
  granularity: "seconds" | "minutes" | "hours";
};

type CollectionSpec = {
  timeseries?: TimeSeriesSpec;
  indexes: IndexDescription[];
  searchIndexes?: SearchIndexDescription[];
};

const SCHEMA: Record<string, CollectionSpec> = {
  [COLLECTIONS.observations]: {
    timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
    indexes: [{ key: { "meta.observerId": 1, ts: -1 } }],
  },
  [COLLECTIONS.frames]: {
    indexes: [
      { key: { hash: 1 }, unique: true, name: "frame_hash_unique" },
      { key: { expireAt: 1 }, expireAfterSeconds: 0, name: "frame_ttl" },
      { key: { observerId: 1, ts: -1 } },
    ],
  },
  [COLLECTIONS.perceptionCache]: {
    indexes: [
      { key: { key: 1 }, unique: true, name: "perception_key_unique" },
      { key: { promptVersion: 1, at: -1 } },
      { key: { expireAt: 1 }, expireAfterSeconds: 0, name: "perception_ttl" },
    ],
  },
  [COLLECTIONS.entities]: {
    indexes: [
      { key: { key: 1 }, unique: true, name: "entity_key_unique" },
      { key: { lastSeen: -1 } },
      { key: { kind: 1, updatedAt: -1 } },
    ],
    searchIndexes: [
      {
        name: "entities_semantic",
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "autoEmbed",
              modality: "text",
              path: "description",
              model: "voyage-4",
            },
            { type: "filter", path: "observerId" },
          ],
        },
      },
      {
        name: "entities_text",
        type: "search",
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              name: { type: "string" },
              aliases: { type: "string" },
              description: { type: "string" },
              place: { type: "string" },
            },
          },
        },
      },
    ],
  },
  [COLLECTIONS.events]: {
    indexes: [
      { key: { ts: -1 } },
      { key: { observerId: 1, ts: -1 } },
      { key: { type: 1, ts: -1 } },
    ],
    searchIndexes: [
      {
        name: "events_semantic",
        type: "vectorSearch",
        definition: {
          fields: [
            {
              type: "autoEmbed",
              modality: "text",
              path: "summary",
              model: "voyage-4",
            },
            { type: "filter", path: "observerId" },
            { type: "filter", path: "type" },
          ],
        },
      },
      {
        name: "events_text",
        type: "search",
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              summary: { type: "string" },
              title: { type: "string" },
            },
          },
        },
      },
    ],
  },
  [COLLECTIONS.zones]: {
    indexes: [{ key: { key: 1 }, unique: true, name: "zone_key_unique" }],
  },
  [COLLECTIONS.privacy]: {
    indexes: [{ key: { observerId: 1, start: 1, end: 1 } }],
  },
  [COLLECTIONS.episodes]: {
    indexes: [
      { key: { observerId: 1, startedAt: -1 } },
      { key: { trigger: 1, startedAt: -1 } },
    ],
  },
  [COLLECTIONS.genomes]: {
    indexes: [
      { key: { version: 1 }, unique: true, name: "genome_version_unique" },
      { key: { status: 1, version: -1 } },
    ],
  },
  [COLLECTIONS.edits]: {
    indexes: [{ key: { genomeVersion: 1, createdAt: -1 } }],
  },
  [COLLECTIONS.evals]: {
    indexes: [{ key: { genomeVersion: 1, split: 1, createdAt: -1 } }],
  },
  [COLLECTIONS.metrics]: {
    timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
    indexes: [],
  },
  // Long-term memory (lib/long-term-memory.ts): turns, facts, episodes, terms.
  [COLLECTIONS.memories]: {
    indexes: [
      { key: { kind: 1, label: 1 } },
      { key: { kind: 1, ts: -1 } },
      { key: { session: 1, ts: -1 } },
    ],
    searchIndexes: [
      {
        name: "memories_semantic",
        type: "vectorSearch",
        definition: {
          fields: [
            { type: "autoEmbed", modality: "text", path: "text", model: "voyage-4" },
            { type: "filter", path: "kind" },
            { type: "filter", path: "observerId" },
          ],
        },
      },
      {
        name: "memories_text",
        type: "search",
        definition: {
          mappings: {
            dynamic: false,
            fields: { text: { type: "string" }, label: { type: "string" } },
          },
        },
      },
    ],
  },
  // Cached web lookups (lib/shelf-life.ts); rows expire on their own.
  [COLLECTIONS.lookups]: {
    indexes: [
      { key: { kind: 1, key: 1 }, unique: true, name: "lookup_key_unique" },
      { key: { expireAt: 1 }, expireAfterSeconds: 0, name: "lookup_ttl" },
    ],
  },
};

export async function ensureSchema(db: Db, log: (line: string) => void) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(
      (c) => c.name,
    ),
  );

  for (const [name, spec] of Object.entries(SCHEMA)) {
    if (!existing.has(name)) {
      await db.createCollection(
        name,
        spec.timeseries ? { timeseries: spec.timeseries } : {},
      );
      log(`created ${name}${spec.timeseries ? " (time series)" : ""}`);
    }

    const collection = db.collection(name);
    if (spec.indexes.length > 0) {
      await collection.createIndexes(spec.indexes);
      log(`indexes ok on ${name}`);
    }

    for (const searchIndex of spec.searchIndexes ?? []) {
      const found = (await collection
        .listSearchIndexes(searchIndex.name!)
        .toArray()) as SearchIndexInfo[];
      if (found.length === 0) {
        await collection.createSearchIndex(searchIndex);
        log(`search index ${searchIndex.name} requested on ${name}`);
      } else {
        await collection.updateSearchIndex(
          searchIndex.name!,
          searchIndex.definition,
        );
        log(
          `search index ${searchIndex.name} on ${name}: ${found[0].status ?? "unknown"}`,
        );
      }
    }
  }
}
