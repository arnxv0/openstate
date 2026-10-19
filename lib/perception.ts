import { log } from "@/lib/log";
import { cameraLabel, observerName } from "@/lib/observers";
import { imageBudget } from "@/lib/groq";
import { episodeFinished, episodeStarted } from "@/lib/episode-queue";
import { createHash } from "node:crypto";
import type { ObjectId } from "mongodb";
import { defineTerm, rememberEpisode } from "@/lib/long-term-memory";
import { COLLECTIONS } from "@/lib/db-schema";
import { formatClock, insertEvent } from "@/lib/events-repo";
import { resolveIdentity, uniqueName } from "@/lib/identity";
import {
  canonicalName,
  formatDelta,
  formatItems,
  normName,
  parseInventory,
  partialTarget,
  reconcile,
  totalCount,
  withCounts,
  type Item,
  type Seen,
} from "@/lib/inventory";
import { generateJson, maxImages, isLiteModel } from "@/lib/llm";
import { db } from "@/lib/mongo";
import { lookupPerception, rememberPerception } from "@/lib/perception-cache";
import { anchorHint, candidateLine, systemPrompt } from "@/lib/site-prompt";
import type { ObserverId } from "@/lib/types";

const PROMPT_VERSION = "episode-v10";
const OBSERVER_IDS: ObserverId[] = ["01", "02"];
const MIN_PASSIVE_CONFIDENCE = 0.8;
const FRAME_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REFERENCES = 3;
const MAX_CANDIDATES = 6;
const EPISODE_TIMEOUT_MS = 25000;

type Reference = { image: string; at: Date; observerId: ObserverId };

/**
 * A registered site (fridge, table, shelf) and what it holds. Stored with
 * kind "container" for compatibility with earlier data.
 */
export type ContainerDoc = {
  key: string;
  kind: "container";
  name: string;
  place?: string;
  items: Item[];
  /** False until the contents have been seen once; items are unknown before that. */
  catalogued?: boolean;
  /** Photos used to tell this site apart from similar ones. */
  references?: Reference[];
  /** The most recent change to the contents, for "who took the …" questions. */
  lastChange?: { summary: string; by: ObserverId; at: Date };
  description: string;
  lastSeen: Date;
  lastObserver: ObserverId;
};

export type EpisodeFrame = {
  image: string;
  at: number;
  phase: "pre" | "during" | "after";
  score?: number;
  /** 64-bit dHash of the frame (16 hex chars), computed on the dashboard. */
  hash?: string;
};

export type EpisodeStats = {
  durationMs: number;
  framesCaptured: number;
  framesDiscarded: number;
  detections: number;
};

type Perceived = {
  place: string | null;
  container: string;
  observed?: string;
  candidatesObserved?: Record<string, string>;
  identity: string;
  identityConfidence?: number;
  identityReason?: string;
  referenceFrame: number | null;
  contentsVisible?: boolean;
  /** Field name used by prompt versions before episode-v4. */
  doorOpened?: boolean;
  inventoryBefore: unknown;
  inventoryAfter: unknown;
  /** "partial" when some of the site was out of frame; such a view cannot prove something is gone. */
  coverage?: "full" | "partial" | null;
  missingKnown?: string[] | null;
  actions?: {
    kind: "removed" | "added";
    item: string;
    count?: number;
    confidence: number;
    /** Whose hand did it: the person holding this camera, someone else in view, or not visible. */
    actor?: "wearer" | "other" | "unknown";
  }[];
};

export type EpisodeResult = {
  episodeId?: string;
  skipped?: "privacy" | "unsure" | "unregistered";
  container?: string;
  identity?: "known" | "new";
  contentsVisible?: boolean;
  inventory?: Seen[] | null;
  coverage?: "full" | "partial";
  changes: string[];
  latencyMs?: number;
  tokens?: number;
  cached?: boolean;
};

const containerKey = (name: string) => `container:${normName(name)}`;

function describe(site: Pick<ContainerDoc, "name" | "place" | "items" | "catalogued">) {
  const where = site.place ? ` in the ${site.place}` : "";
  if (site.catalogued === false) return `The ${site.name}${where}; contents not seen yet.`;
  return `The ${site.name}${where} holds: ${formatItems(site.items)}.`;
}

export async function listContainers() {
  const docs = await (await db())
    .collection<ContainerDoc>(COLLECTIONS.entities)
    .find({ kind: "container" }, { projection: { references: 0 } })
    .sort({ lastSeen: -1 })
    .toArray();
  return docs.map((doc) => ({ ...doc, items: withCounts(doc.items) }));
}

/** One reference photo per registered site, newest sites first, for "where am I". */
export async function siteReferences(limit = 4) {
  const docs = await (await db())
    .collection<ContainerDoc>(COLLECTIONS.entities)
    .find({ kind: "container", "references.0": { $exists: true } }, { projection: { name: 1, place: 1, references: { $slice: 1 } } })
    .sort({ lastSeen: -1 })
    .limit(limit)
    .toArray();
  return docs.flatMap((doc) =>
    doc.references?.[0] ? [{ name: doc.name, place: doc.place, image: doc.references[0].image }] : [],
  );
}

async function privacyActive(observerId: ObserverId) {
  const now = new Date();
  const window = await (await db())
    .collection(COLLECTIONS.privacy)
    .findOne({ observerId, start: { $lte: now }, end: { $gt: now } });
  return Boolean(window);
}

export async function openPrivacyWindow(observerId: ObserverId, minutes = 5) {
  const start = new Date();
  await (await db()).collection(COLLECTIONS.privacy).insertOne({
    observerId,
    start,
    end: new Date(start.getTime() + minutes * 60000),
  });
}

async function storeFrames(observerId: ObserverId, frames: EpisodeFrame[]) {
  const collection = (await db()).collection(COLLECTIONS.frames);
  const expireAt = new Date(Date.now() + FRAME_TTL_MS);
  const hashes: string[] = [];
  for (const frame of frames) {
    const hash = createHash("sha256").update(frame.image).digest("hex");
    hashes.push(hash);
    await collection.updateOne(
      { hash },
      {
        $setOnInsert: {
          hash,
          observerId,
          ts: new Date(frame.at),
          phase: frame.phase,
          phash: frame.hash,
          image: frame.image,
          expireAt,
        },
      },
      { upsert: true },
    );
  }
  return hashes;
}

function candidateParts(candidates: ContainerDoc[], refs?: number[]) {
  if (candidates.length === 0) return [{ text: "CANDIDATES: none registered yet." }];
  return candidates.flatMap((candidate, index) => [
    {
      text: candidateLine(
        {
          name: candidate.name,
          place: candidate.place,
          items: candidate.items,
          catalogued: candidate.catalogued,
          lastSeen: formatClock(candidate.lastSeen),
          lastObserver: candidate.lastObserver,
          references: candidate.references?.length ?? 0,
        },
        index,
      ),
    },
    ...(candidate.references ?? []).slice(0, refs ? refs[index] : undefined).map((ref) => ({
      inline_data: { mime_type: "image/jpeg", data: ref.image },
    })),
  ]);
}

/**
 * Perceives an episode and reconciles it against the registered site it
 * shows. Identity (which of several similar sites this is, or a new one) is
 * decided by the same model call that reads and counts the contents, from the
 * candidates' reference photos and known contents.
 *
 * `register` is the name the user gave when saying "remember this"; the site
 * is created under that name unless it is already registered.
 */
const lockStore = globalThis as typeof globalThis & { __openstateWriteLock?: Promise<void> };

/** Resolves when earlier episodes have finished writing; call the result to let the next one in. */
async function acquireWriteLock() {
  const previous = lockStore.__openstateWriteLock ?? Promise.resolve();
  let release = () => {};
  lockStore.__openstateWriteLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  return release;
}

export async function perceiveEpisode(input: Parameters<typeof perceive>[0]): Promise<EpisodeResult> {
  // Counted while the model reads it, so questions wait for the outcome.
  episodeStarted(input.observerId);
  try {
    return await perceive(input);
  } finally {
    episodeFinished();
  }
}

async function perceive({
  observerId,
  trigger,
  frames,
  stats,
  container = "fridge",
  anchorKey,
  anchorName,
  register,
  knownOnly,
  passive,
}: {
  observerId: ObserverId;
  trigger: string;
  frames: EpisodeFrame[];
  stats?: EpisodeStats;
  /** Kind of site the frames show ("fridge", "table"); used in the prompt. */
  container?: string;
  anchorKey?: string;
  /** Name of the saved anchor the on-device matcher recognised, if any. */
  anchorName?: string;
  register?: string;
  /**
   * The dashboard sent this on movement alone, without recognising anything.
   * It may update a registered place it turns out to show, but must never
   * register a new one: most movement is just someone walking around.
   */
  knownOnly?: boolean;
  /**
   * Nothing on the dashboard recognised the place (no anchor match, no
   * detector hit): the model's match has to be a confident one.
   */
  passive?: boolean;
}): Promise<EpisodeResult> {
  if (await privacyActive(observerId)) return { skipped: "privacy", changes: [] };

  const database = await db();
  const entities = database.collection<ContainerDoc>(COLLECTIONS.entities);
  const candidates = (
    await entities.find({ kind: "container" }).sort({ lastSeen: -1 }).limit(MAX_CANDIDATES).toArray()
  ).map((doc) => ({ ...doc, items: withCounts(doc.items) }));
  if (knownOnly && candidates.length === 0) return { skipped: "unregistered", changes: [] };
  const startedAt = frames[0]?.at ?? Date.now();
  const hashes = await storeFrames(observerId, frames);
  const hint = anchorName
    ? anchorHint(
        normName(anchorName),
        candidates.map((c) => c.name),
      )
    : null;

  // Only byte-identical keyframe sets reuse an earlier answer, and only while
  // the candidates and their contents are unchanged: a near-identical frame
  // can still hide a moved item, and a new registration can change identity.
  const frameHashes = frames.map((frame) => frame.hash);
  const candidateSig = candidates
    .map((c) => `${c.key}@${c.references?.length ?? 0}/${formatItems(c.items)}`)
    .join(",");
  const cacheVersion = `${PROMPT_VERSION}:${container}:${createHash("sha256").update(candidateSig).digest("hex").slice(0, 16)}`;
  const cached = register ? null : await lookupPerception<Perceived>(cacheVersion, frameHashes);
  // A provider with an image limit gets the first and last frame, then one
  // reference photo per candidate; the candidate the dashboard's anchor match
  // points at goes first so its photo is the one kept.
  candidates.sort((a, b) => Number(b.name === anchorName) - Number(a.name === anchorName));
  const budget = imageBudget(
    maxImages(),
    candidates.map((candidate) => candidate.references?.length ?? 0),
    frames.length,
  );
  // Motion-started looks get every keyframe too: with only three, the frame
  // that shows a snack leaving was dropped and the removal was missed. One
  // reference photo per place is enough to say which place it is.
  const lean = knownOnly ? { frames: budget.frames } : null;
  const sent = (lean ?? budget).frames.map((index) => frames[index]);
  const result = cached
    ? {
        data: cached.perceived,
        model: `cache:${cached.model}`,
        usage: { input: 0, output: 0, total: 0 },
        latencyMs: 0,
      }
    : await generateJson<Perceived>({
        timeoutMs: EPISODE_TIMEOUT_MS,
        // With reasoning off the model echoes the known contents instead of
        // reading the site; "low" costs ~2 s more and finds removed items.
        reasoning: "low",
        system: systemPrompt(container),
        parts: [
          ...candidateParts(candidates, lean ? candidates.map(() => 1) : budget.refs),
          ...(hint ? [{ text: hint }] : []),
          { text: `EPISODE (${sent.length} frame${sent.length === 1 ? "" : "s"}):` },
          ...sent.flatMap((frame, index) => [
            {
              text: `Frame ${index + 1} of ${sent.length} (${frame.phase}, t=${((frame.at - startedAt) / 1000).toFixed(1)}s)`,
            },
            { inline_data: { mime_type: "image/jpeg", data: frame.image } },
          ]),
        ],
      });
  if (!cached && !register) {
    await rememberPerception(cacheVersion, frameHashes, result.data, result.model).catch(() => {});
  }

  const perceived = result.data;
  const now = new Date();
  const time = formatClock(now);
  const place = perceived.place ? normName(perceived.place) : undefined;
  const contentsVisible = Boolean(perceived.contentsVisible ?? perceived.doorOpened);

  const verdict = resolveIdentity({
    identity: perceived.identity,
    confidence: perceived.identityConfidence,
    trusted: !isLiteModel(result.model),
    candidates: candidates.length,
  });
  // A look nobody asked for (the phone just moved) has to be a confident
  // match: a vague resemblance to a saved table must not pull in whatever is
  // lying on some other surface.
  const confident = verdict.kind === "known" && (!passive || verdict.confidence >= MIN_PASSIVE_CONFIDENCE);
  const matched = verdict.kind === "known" && confident ? candidates[verdict.index] : null;
  const unsure = verdict.kind === "unsure";

  // Two phones watching the same place finish within seconds of each other.
  // Each read the contents before its model call, so without this both would
  // record the same laptop leaving, and the later write would take the
  // credit. From here on episodes run one at a time against fresh contents.
  const release = await acquireWriteLock();
  try {
  const fresh = matched ? await entities.findOne({ key: matched.key }) : null;
  const current = matched ? { ...matched, ...(fresh ?? {}), items: withCounts((fresh ?? matched).items) } : null;

  // Names are matched against the identified site's known spellings so
  // "coke cans" does not read as a new item next to "coke can".
  const known = (current?.items ?? []).map((item) => item.name);
  const after = parseInventory(perceived.inventoryAfter, known);
  const before = parseInventory(perceived.inventoryBefore, known);
  // Anything not positively judged a full view may only add: an occluded or
  // unjudged last frame must not read as "everything else is gone".
  const partial = perceived.coverage !== "full";
  // Removals the model saw happening (a hand taking the can), with how many.
  const removals =
    parseInventory(
      (perceived.actions ?? [])
        .filter((action) => action.kind === "removed" && action.confidence >= 0.6)
        .map((action) => ({ name: action.item, count: action.count ?? 1 })),
      known,
    ) ?? [];
  const handled = new Set(removals.map((item) => item.name));
  const addedNames = new Set(
    (perceived.actions ?? [])
      .filter((action) => action.kind === "added" && action.confidence >= 0.7 && typeof action.item === "string")
      .map((action) => canonicalName(action.item, known)),
  );
  const actors = new Map(
    (perceived.actions ?? [])
      .filter((action) => action.confidence >= 0.6 && typeof action.item === "string")
      .map((action) => [canonicalName(action.item, known), action.actor ?? "unknown"] as const),
  );
  // With two phones, "someone other than the camera holder" is the other one.
  const others = OBSERVER_IDS.filter((id) => id !== observerId);
  const whoDid = (item: string) => {
    const actor = actors.get(item);
    if (actor === "wearer") return observerName(observerId);
    if (actor === "other" && others.length === 1) return `probably ${observerName(others[0])}`;
    return null;
  };
  // A removal this camera watched happen, with nobody else seen doing it, is
  // most likely the person holding the phone: say so, hedged.
  const likelyTaker = (item: string) => whoDid(item) ?? (actors.get(item) === "other" ? null : `probably ${observerName(observerId)}`);
  const referenceIndex = (perceived.referenceFrame ?? 0) - 1;
  const referenceFrame = frames[referenceIndex] ?? (register ? frames[0] : undefined);
  const reference = referenceFrame
    ? { image: referenceFrame.image, at: new Date(referenceFrame.at), observerId }
    : undefined;

  const changes: string[] = [];
  let identity: "known" | "new" | undefined;
  let name = current?.name;
  // "Remember this" and the watcher's first episode can both find no site and
  // each create one under a different name; the later of the two defers.
  const raced =
    !unsure && !current
      ? await entities.findOne(
          {
            kind: "container",
            key: { $nin: candidates.map((c) => c.key) },
            lastSeen: { $gte: new Date(now.getTime() - 60_000) },
          },
          { projection: { name: 1 } },
        )
      : null;

  if (knownOnly && !current && !raced) {
    log("episode", "not matched to a saved place", {
      observer: observerId,
      trigger,
      identity: perceived.identity,
      confidence: perceived.identityConfidence,
      reason: perceived.identityReason,
      candidates: candidates.map((c) => c.name),
      verdict: verdict.kind,
    });
    return { skipped: "unregistered", changes: [], latencyMs: result.latencyMs, tokens: result.usage.total };
  }
  if (unsure) {
    changes.push("identity unsure");
  } else if (raced) {
    identity = "known";
    name = raced.name;
  } else if (!current) {
    identity = "new";
    const base = normName(register || perceived.container || container);
    name = uniqueName(
      base,
      candidates.map((c) => c.name),
    );
    const items: Item[] = (after ?? []).map((item) => ({ ...item, since: now, by: observerId }));
    const doc: ContainerDoc = {
      key: containerKey(name),
      kind: "container",
      name,
      place,
      items,
      catalogued: Boolean(after),
      references: reference ? [reference] : [],
      description: "",
      lastSeen: now,
      lastObserver: observerId,
    };
    doc.description = describe(doc);
    await entities.updateOne({ key: doc.key }, { $setOnInsert: doc }, { upsert: true });
    await insertEvent({
      type: "observation",
      observerId,
      title: register ? `${name} registered` : `New ${base} seen: ${name}`,
      location: place ? [place, name] : [name],
      message: after
        ? `${totalCount(items)} things seen by Observer ${observerId}`
        : `Contents not seen yet · registered by Observer ${observerId}`,
      metadata: after ? { items: items.map((item) => formatItems([item])) } : undefined,
      summary: `${describe(doc)} ${register ? "Registered" : "First seen"} by observer ${observerId} at ${time}.`,
    });
    changes.push(after ? `new ${name} · ${formatItems(items)}` : `new ${name}`);
    // Taxonomic memory: the household's vocabulary of places and sites.
    void defineTerm({
      term: name,
      definition: `A ${base}${place ? ` in the ${place}` : ""} that OPENSTATE watches. ${register ? "Registered" : "First seen"} by observer ${observerId}.`,
      relatedTerms: [base, ...(place ? [place] : [])].filter((t) => t !== name),
    });
  } else {
    identity = "known";
    const references = current.references ?? [];
    const $set: Partial<ContainerDoc> = {
      lastSeen: now,
      lastObserver: observerId,
      place: current.place ?? place,
    };
    // A wrong match must not add a photo of another site to this one's
    // references, or the next sighting of that other site matches too.
    if (reference && verdict.confidence >= 0.8 && references.length < MAX_REFERENCES) {
      $set.references = [...references, reference];
    }
    const location = $set.place ? [$set.place, current.name] : [current.name];

    if (after && current.catalogued === false) {
      const items: Item[] = after.map((item) => ({ ...item, since: now, by: observerId }));
      Object.assign($set, { items, catalogued: true });
      await insertEvent({
        type: "observation",
        observerId,
        title: `${current.name} catalogued`,
        location,
        message: `${totalCount(items)} things seen by Observer ${observerId}`,
        metadata: { items: items.map((item) => formatItems([item])) },
        summary: `${describe({ ...current, items, catalogued: true })} First catalogued by observer ${observerId} at ${time}.`,
      });
      changes.push(`catalogued ${formatItems(items)}`);
    } else if (after) {
      // A full view replaces the contents. A partial view can add, but only
      // takes away what was seen being taken: out of frame is not gone.
      // On a partial view a thing never seen at this place before is more
      // likely background (a cup on the next table) than a new arrival, so
      // only a full view, or an addition the model saw happen, adds a name.
      const knownNames = new Set(current.items.map((item) => item.name));
      const sure = partial
        ? after.filter((item) => knownNames.has(item.name) || addedNames.has(item.name))
        : after;
      const target = partial ? partialTarget(current.items, sure, removals) : sure;
      const { items, deltas } = reconcile(current.items, target, observerId, now);
      $set.items = items;

      for (const delta of deltas) {
        const amount = Math.abs(delta.to - delta.from);
        const things = `${amount} ${delta.name}`;
        const left = delta.to > 0 ? `${delta.to} left` : "none left";
        if (delta.to < delta.from) {
          const witnessed =
            handled.has(delta.name) ||
            (before?.find((item) => item.name === delta.name)?.count ?? 0) > delta.to;
          await insertEvent({
            type: "transition",
            observerId,
            title: witnessed ? "Taken" : `Gone from ${current.name}`,
            location,
            metadata: {
              object: delta.name,
              from: current.name,
              to: witnessed ? (likelyTaker(delta.name) ?? `Seen by ${cameraLabel(observerId)}`) : "Unknown",
              detail: `${delta.from} → ${delta.to}`,
            },
            summary: witnessed
              ? likelyTaker(delta.name)
                ? `${likelyTaker(delta.name)} took ${things} from the ${current.name} at ${time}, seen by ${cameraLabel(observerId)}; ${left}.`
                : `${things} was taken from the ${current.name} at ${time}, seen happening by ${cameraLabel(observerId)}; ${left}.`
              : `${things} was gone from the ${current.name} when ${observerName(observerId)} looked at ${time}; ${left}.`,
          });
        } else {
          await insertEvent({
            type: "transition",
            observerId,
            title: "Added",
            location,
            metadata: {
              object: delta.name,
              from: `Observer ${observerId}`,
              to: current.name,
              detail: `${delta.from} → ${delta.to}`,
            },
            summary: `${things} was added to the ${current.name}; seen by ${cameraLabel(observerId)} at ${time}; now ${delta.to}.`,
          });
        }
        changes.push(formatDelta(delta));
      }
      if (deltas.length > 0) {
        const takers = [...new Set(deltas.filter((d) => d.to < d.from).map((d) => likelyTaker(d.name)).filter(Boolean))];
        $set.lastChange = {
          summary: deltas.map(formatDelta).join(", ") + (takers.length ? `, taken by ${takers.join(" and ")}` : ""),
          by: observerId,
          at: now,
        };
      }
    }

    $set.description = describe({ ...current, ...$set });
    await entities.updateOne({ key: current.key }, { $set });
  }

  const tokens = result.usage.total;
  const episode = await database.collection(COLLECTIONS.episodes).insertOne({
    observerId,
    trigger,
    anchorKey,
    container: name ?? null,
    identity: identity ?? "unsure",
    identityConfidence: perceived.identityConfidence,
    identityReason: perceived.identityReason,
    candidates: candidates.map((c) => c.key),
    startedAt: new Date(startedAt),
    endedAt: new Date(frames.at(-1)?.at ?? Date.now()),
    frameHashes: hashes,
    stats,
    perceived,
    changes,
    model: result.model,
    cached: Boolean(cached),
    promptVersion: PROMPT_VERSION,
    tokens,
    latencyMs: result.latencyMs,
  });

  const outcome = changes.length
    ? changes.join(" · ")
    : contentsVisible
      ? "no change"
      : "contents not visible";
  if (name && !unsure && (changes.length > 0 || after)) {
    // Episodic memory: one record per sighting that changed or read something.
    void rememberEpisode({
      title: `${name}: ${outcome}`,
      content: [
        `Observer ${observerId} looked at the ${name} at ${time} (trigger: ${trigger}).`,
        changes.length ? `Changes: ${changes.join(", ")}.` : "Nothing changed.",
        after ? `${partial ? "In view" : "Contents"} then: ${formatItems(after)}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      summary: `${name} · ${outcome}`,
      observerId,
      tags: [name, trigger],
      metadata: { container: name, changes, episodeId: (episode.insertedId as ObjectId).toHexString() },
    });
  }
  // Motion-started looks that found nothing new stay out of the context
  // stream; they happen every few seconds while a phone is moving.
  if (!register && !(knownOnly && changes.length === 0)) {
    const discarded = stats?.framesDiscarded ?? 0;
    await insertEvent({
      type: "system",
      observerId,
      title: `${name ?? perceived.container ?? container} episode · ${((stats?.durationMs ?? 0) / 1000).toFixed(0)}s · ${frames.length} keyframes sent · ${discarded} frames discarded on device · ${outcome}${cached ? " · perception cached" : ""}`,
      summary: `Perception episode for the ${name ?? container} by observer ${observerId}`,
    });
  }

  return {
    episodeId: (episode.insertedId as ObjectId).toHexString(),
    skipped: unsure ? "unsure" : undefined,
    container: name,
    identity,
    contentsVisible,
    inventory: after,
    coverage: after ? (partial ? "partial" : "full") : undefined,
    changes,
    latencyMs: result.latencyMs,
    tokens,
    cached: Boolean(cached),
  };
  } finally {
    release();
  }
}
