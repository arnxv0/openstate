"use client";

import { clog } from "@/lib/client-log";
import { useEffect, useRef, useState, type RefObject } from "react";
import { embedVariants, loadAnchorEmbedder } from "@/lib/anchor-embedder";
import {
  getAnchors,
  loadAnchors,
  matchAnchor,
  onAnchorCapture,
  type Anchor,
} from "@/lib/anchor-bank";
import { anchorSeen as anchorGate, dominantAnchor } from "@/lib/anchor-match";
import {
  CHANGE_THRESHOLD,
  difference,
  dropLeastChanged,
  episodeEnd,
  isActivity,
  pickKeyframes,
  usableFrames,
} from "@/lib/episode-logic";
import { allCovered, dHash, nearDuplicate, THUMB_H, THUMB_W, toGray } from "@/lib/frame-diff";
import { detectSite, loadSiteDetector, type Box } from "@/lib/site-detector";
import type { ObserverId } from "@/lib/types";

const TICK_MS = 250;
const RING_EVERY_MS = 500;
const RING_SIZE = 6;
const DURING_EVERY_MS = 1000;
const HITS_TO_TRIGGER = 3;
const HISTORY = 5;
const MIN_SCORE = 0.4;
const MAX_EPISODE_FRAMES = 20;
const COOLDOWN_MS = 1000;
// Idle motion older than this belongs to something already over.
const IDLE_ACTIVITY_MS = 6000;
// Motion-started looks: at most this long, and this far apart per phone, so
// someone walking around costs a model call every several seconds at most.
const MOTION_EPISODE_MS = 10_000;
const MOTION_EVERY_MS = 12_000;
// While movement continues, renew the "episode coming" notice this often.
const ANNOUNCE_EVERY_MS = 3000;
const FRAME_WIDTH = 640;
const STALE_AFTER_MS = 1500;
// A static scene whose keyframes all near-duplicate the previous episode is
// not re-sent for this long; the server cache catches anything that slips by.
const REPEAT_SKIP_MS = 10 * 60 * 1000;
// After "remember this": keep the pre-roll ring plus this much more video as
// reference views, deduplicated by perceptual hash.
const ANCHOR_CAPTURE_MS = 2500;
const ANCHOR_MAX_REFERENCES = 10;

type Frame = {
  image: string;
  at: number;
  phase: "pre" | "during" | "after";
  score?: number;
  seen?: boolean;
  thumb?: Uint8Array;
  hash: string;
  embeddings?: number[][];
};

type Reference = { embeddings: number[][]; hash: string };

type WatchPhase = "loading" | "watching" | "capturing" | "sending" | "error";

export type AnchorWatch = {
  phase: WatchPhase;
  box: Box | null;
  frameSize: { width: number; height: number } | null;
  captured: number;
  lastResult: string | null;
  /** Best anchor for the latest frame; active when above the match threshold. */
  anchor: { name: string; similarity: number; active: boolean } | null;
  /** Number of saved anchors; 0 means the class detector is the gate. */
  anchors: number;
  /** What the capture in progress (or the detector box) is looking at: "fridge", "table", an anchor name. */
  site: string | null;
};

function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  canvas.width = Math.min(FRAME_WIDTH, video.videoWidth);
  canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL("image/jpeg", 0.72);

  let thumb: Uint8Array | undefined;
  let hash = "0".repeat(16);
  if (ctx) {
    ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const { data } = ctx.getImageData(0, 0, THUMB_W, THUMB_H);
    thumb = toGray(data, THUMB_W * THUMB_H);
    hash = dHash(thumb);
  }
  return { image, thumb, hash };
}

export function useAnchorWatch({
  videoRef,
  observerId,
  enabled,
  leader,
  viewer,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  observerId: ObserverId;
  enabled: boolean;
  leader: boolean;
  viewer: string;
}) {
  const [watch, setWatch] = useState<AnchorWatch>({
    phase: "loading",
    box: null,
    frameSize: null,
    captured: 0,
    lastResult: null,
    anchor: null,
    anchors: 0,
    site: null,
  });
  const leaderRef = useRef(leader);
  useEffect(() => {
    leaderRef.current = leader;
  }, [leader]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer = 0;
    const canvas = document.createElement("canvas");
    const ring: Frame[] = [];
    const history: boolean[] = [];
    const recentAnchors: (Anchor | null)[] = [];
    let discarded = 0;
    let detections = 0;
    let lastRingAt = 0;
    let lastVideoTime = -1;
    let lastAdvanceAt = 0;
    let cooldownUntil = 0;
    // Motion seen between episodes (during the cooldown, or before the site
    // was recognised) still has to end in a report once the view settles.
    let idleActivityAt: number | null = null;
    // The first look at a site, and the first after losing sight of it, are
    // sent once the view is still instead of waiting out the full timeout.
    let resync = true;
    let detectFailures = 0;
    let announcedAt = 0;
    let sending: Promise<void> = Promise.resolve();
    let lastSent: { hashes: string[]; at: number } | null = null;
    let episode: {
      startedAt: number;
      lastSeen: number;
      lastFrameAt: number;
      frames: Frame[];
      anchor: Anchor | null;
      /** Site kind from the detector when no anchor matched ("fridge", "table"). */
      site: string | null;
      /** When the view last changed (a hand reaching in); null while still. */
      lastActivityAt: number | null;
      /** Started by movement alone; the server decides whether it shows a registered place. */
      generic: boolean;
    } | null = null;
    let nextMotionAt = 0;
    let pendingAnchor: { name: string; until: number; references: Reference[] } | null = null;

    const update = (patch: Partial<AnchorWatch>) => {
      if (!stopped) setWatch((current) => ({ ...current, ...patch }));
    };

    const send = async (
      frames: Frame[],
      durationMs: number,
      anchor: Anchor | null,
      site: string | null,
      reason: string,
      generic = false,
    ) => {
      // Black start-up frames and motion-blurred ones make poor evidence and
      // poor snapshots; choose keyframes from what is left.
      const usable = usableFrames(frames);
      const keyframes = pickKeyframes(usable);
      if (usable.length < frames.length) {
        clog("watch", "dropped unusable frames", { observer: observerId, dropped: frames.length - usable.length, kept: usable.length });
      }
      const stats = {
        durationMs,
        framesCaptured: frames.length,
        framesDiscarded: discarded + (frames.length - keyframes.length),
        detections,
      };
      discarded = 0;
      detections = 0;
      if (!leaderRef.current) {
        clog("watch", "episode dropped: this tab does not hold the capture lease", { observer: observerId, reason });
        update({ phase: "watching", captured: 0 });
        return;
      }
      const hashes = keyframes.map((frame) => frame.hash);
      const now = Date.now();
      if (
        lastSent &&
        now - lastSent.at < REPEAT_SKIP_MS &&
        allCovered(hashes, lastSent.hashes, 0)
      ) {
        // Same scene as the last episode (static phone, nothing moved):
        // nothing to learn, so skip the upload and the model call.
        clog("watch", "episode skipped: same frames as the last one sent", { observer: observerId, reason });
        update({ phase: "watching", captured: 0, lastResult: "unchanged scene · skipped" });
        return;
      }
      update({ phase: "sending" });
      try {
        const post = () =>
          fetch("/api/episodes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              observerId,
              viewer,
              trigger: `${anchor?.name ?? site ?? (generic ? "motion" : "site")} · ${reason}`,
              knownOnly: generic || undefined,
              passive: generic || undefined,
              anchor: anchor ? { key: anchor.key, name: anchor.name, container: anchor.container } : undefined,
              site: site ?? undefined,
              frames: keyframes.map(({ image, at, phase, score, hash }) => ({ image, at, phase, score, hash })),
              stats,
            }),
          });
        // These frames may be the only record of a can being taken, so a
        // failed upload or model call gets one more try.
        let response = await post().catch(() => null);
        if (!response || response.status >= 500) {
          clog("watch", "episode upload failed, retrying once", { observer: observerId, status: response?.status ?? "network" });
          response = await post();
        }
        const result = (await response.json()) as {
          container?: string;
          changes?: string[];
          contentsVisible?: boolean;
          cached?: boolean;
          skipped?: string;
          error?: string;
        };
        if (response.ok && !result.error) lastSent = { hashes, at: now };
        clog("watch", "episode result", {
          observer: observerId,
          status: response.status,
          site: result.container,
          changes: result.changes,
          contentsVisible: result.contentsVisible,
          skipped: result.skipped,
          error: result.error,
          ms: Date.now() - now,
        });
        const outcome =
          result.skipped === "privacy"
            ? "privacy pause"
            : result.skipped === "unregistered"
              ? "not a saved place"
            : result.changes?.length
              ? result.changes.join(" ")
              : result.contentsVisible
                ? "no change"
                : "contents not visible";
        const summary =
          result.error ?? (result.container ? `${result.container} · ${outcome}` : outcome);
        update({
          phase: "watching",
          captured: 0,
          lastResult: result.cached ? `${summary} · cached` : summary,
        });
      } catch (cause) {
        clog("watch", "episode send failed", { observer: observerId, error: String(cause).slice(0, 200) });
        update({ phase: "watching", captured: 0, lastResult: "send failed" });
      }
    };

    const addReference = (references: Reference[], frame: Frame) => {
      if (!frame.embeddings?.length || references.length >= ANCHOR_MAX_REFERENCES) return;
      if (references.some((ref) => nearDuplicate(ref.hash, frame.hash))) return;
      references.push({ embeddings: frame.embeddings, hash: frame.hash });
    };

    const saveAnchor = async (pending: { name: string; references: Reference[] }) => {
      const references = pending.references.flatMap((ref) =>
        ref.embeddings.map((embedding) => ({ embedding, hash: ref.hash })),
      );
      if (references.length === 0) {
        clog("watch", "anchor not saved: no embedded views captured", { observer: observerId, name: pending.name });
        update({ lastResult: `anchor "${pending.name}" not saved · no views` });
        return;
      }
      try {
        const response = await fetch("/api/anchors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: pending.name, observerId, viewer, references }),
        });
        const body = (await response.json()) as { name?: string; references?: number; error?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? `anchors ${response.status}`);
        await loadAnchors().catch(() => {});
        clog("watch", "anchor saved", { observer: observerId, name: body.name, views: body.references });
        update({
          lastResult: `anchor saved · ${body.name} · ${body.references} views`,
          anchors: getAnchors().length,
        });
      } catch (cause) {
        clog("watch", "anchor save failed", { observer: observerId, name: pending.name, error: String(cause).slice(0, 200) });
        update({ lastResult: cause instanceof Error ? cause.message : "anchor save failed" });
      }
    };

    const unsubscribeCapture = onAnchorCapture(({ observerId: target, name }) => {
      if (target !== observerId || !leaderRef.current || stopped) return;
      const references: Reference[] = [];
      for (const frame of [...ring, ...(episode?.frames ?? [])]) addReference(references, frame);
      pendingAnchor = { name, until: Date.now() + ANCHOR_CAPTURE_MS, references };
      clog("watch", "anchor capture started", { observer: observerId, name, viewsSoFar: references.length });
      update({ lastResult: `remembering ${name}…` });
    });

    type Models = {
      detector: Awaited<ReturnType<typeof loadSiteDetector>>;
      embedder: Awaited<ReturnType<typeof loadAnchorEmbedder>> | null;
    };

    const tick = ({ detector, embedder }: Models) => {
      const video = videoRef.current;
      if (stopped || !video || video.readyState < 2 || !video.videoWidth) return;
      const now = Date.now();
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        lastAdvanceAt = now;
      }
      const stale = now - lastAdvanceAt > STALE_AFTER_MS;

      let box: Box | null = null;
      let variants: number[][] = [];
      if (!stale) {
        try {
          box = detectSite(detector, video);
          if (embedder) variants = embedVariants(embedder, video, box);
          detectFailures = 0;
        } catch {
          // A lost graphics context throws on every tick; say so rather than
          // showing "watching" while nothing can be seen.
          detectFailures += 1;
          if (detectFailures === 8) {
            clog("watch", "detector threw 8 times in a row", { observer: observerId });
            update({ phase: "error", lastResult: "detector failing · reload the dashboard" });
          }
          return;
        }
      }
      const classSeen = Boolean(box && box.score >= MIN_SCORE);
      if (classSeen) detections += 1;

      // Gate: a detected fridge or table always counts; saved anchors add
      // places the detector cannot see (wardrobe, shelf). Which site it is
      // gets decided on the server from reference photos, not from these
      // embeddings, which score the same fridge from another angle below two
      // different fridges.
      const anchors = getAnchors();
      const match = variants.length ? matchAnchor(variants) : null;
      const anchorSeen = anchorGate(match, Boolean(episode?.anchor));
      const seen = classSeen || anchorSeen;
      history.push(seen);
      recentAnchors.push(anchorSeen && !classSeen && match ? match.anchor : null);
      if (history.length > HISTORY) {
        history.shift();
        recentAnchors.shift();
      }

      const sampleDue = !stale && now - lastRingAt >= RING_EVERY_MS;
      const sample: Frame | null = sampleDue
        ? { ...grab(video, canvas), at: now, phase: "pre", score: box?.score, seen, embeddings: variants }
        : null;
      if (sample) lastRingAt = now;

      if (pendingAnchor) {
        if (sample) addReference(pendingAnchor.references, sample);
        if (now >= pendingAnchor.until || pendingAnchor.references.length >= ANCHOR_MAX_REFERENCES) {
          const pending = pendingAnchor;
          pendingAnchor = null;
          saveAnchor(pending);
        }
      }

      if (!episode) {
        if (sample) {
          if (isActivity(sample.thumb, ring.at(-1)?.thumb)) idleActivityAt = now;
          ring.push(sample);
          if (ring.length > RING_SIZE) {
            ring.shift();
            discarded += 1;
          }
        }
        const hits = history.filter(Boolean).length;
        const recognised = hits >= HITS_TO_TRIGGER;
        // Nothing recognised, but the view just changed: a saved place seen
        // from a new angle, or a place with no detector class and no anchor
        // yet. Send a short look and let the server match it against the
        // reference photos of registered places.
        const moved = idleActivityAt !== null && now - idleActivityAt < IDLE_ACTIVITY_MS;
        const generic = !recognised && moved && now >= nextMotionAt;
        if ((recognised || generic) && now >= cooldownUntil) {
          episode = {
            startedAt: ring[0]?.at ?? now,
            lastSeen: now,
            lastFrameAt: now,
            frames: [...ring],
            anchor: dominantAnchor(recentAnchors),
            site: box?.site ?? null,
            generic,
            lastActivityAt:
              resync || (idleActivityAt !== null && now - idleActivityAt < IDLE_ACTIVITY_MS)
                ? (idleActivityAt ?? now)
                : null,
          };
          clog("watch", "episode started", {
            observer: observerId,
            by: generic ? "motion" : classSeen ? "detector" : "anchor",
            site: episode.site,
            anchor: episode.anchor?.name,
            score: box?.score,
            similarity: match?.similarity,
            resync,
            preRoll: episode.frames.length,
          });
          resync = false;
          idleActivityAt = null;
          ring.length = 0;
        }
      } else {
        // A motion-started episode has nothing to lose sight of; it ends when
        // the view settles, or at its own short cap.
        if (seen || episode.generic) episode.lastSeen = now;
        if (!episode.site && classSeen && box) episode.site = box.site;
        if (sample) {
          const previous = episode.frames.at(-1);
          if (isActivity(sample.thumb, previous?.thumb)) {
            // First movement of this episode: tell the server a result is
            // coming, so a question asked right now waits for it.
            if (episode.lastActivityAt === null || now - announcedAt > ANNOUNCE_EVERY_MS) {
              announcedAt = now;
              // Only for a recognised place: motion-started looks run all the
              // time while a phone moves and would hold every question.
              if (leaderRef.current && !episode.generic) {
                fetch("/api/episodes/pending", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ observerId, viewer }),
                }).catch(() => {});
              }
            }
            episode.lastActivityAt = now;
          }
          const changed = difference(sample.thumb, previous?.thumb) > CHANGE_THRESHOLD;
          if (changed || now - episode.lastFrameAt >= DURING_EVERY_MS) {
            episode.lastFrameAt = now;
            episode.frames.push({ ...sample, phase: "during" });
          } else {
            discarded += 1;
          }
          if (episode.frames.length > MAX_EPISODE_FRAMES) {
            dropLeastChanged(episode.frames);
            discarded += 1;
          }
        }
        const reason =
          episode.generic && now - episode.startedAt > MOTION_EPISODE_MS
            ? "timeout"
            : episodeEnd({
                now,
                startedAt: episode.startedAt,
                lastSeen: episode.lastSeen,
                lastActivityAt: episode.lastActivityAt,
              });
        if (reason) {
          episode.frames.push({ ...grab(video, canvas), at: now, phase: "after", score: box?.score, seen });
          const finished = episode;
          episode = null;
          cooldownUntil = now + COOLDOWN_MS;
          history.length = 0;
          recentAnchors.length = 0;
          if (reason === "lost") resync = true;
          if (finished.generic) nextMotionAt = now + MOTION_EVERY_MS;
          clog("watch", "episode ended", {
            observer: observerId,
            reason,
            frames: finished.frames.length,
            ms: now - finished.startedAt,
            site: finished.site,
            anchor: finished.anchor?.name,
          });
          // One episode at a time on the server: a slow earlier episode
          // landing after a later one would write the old count back.
          const duration = now - finished.startedAt;
          sending = sending.then(() =>
            send(finished.frames, duration, finished.anchor, finished.site, reason, finished.generic),
          );
        }
      }

      update({
        box: classSeen ? box : null,
        frameSize: { width: video.videoWidth, height: video.videoHeight },
        anchor: match ? { name: match.anchor.name, similarity: match.similarity, active: anchorSeen } : null,
        anchors: anchors.length,
        site: episode?.anchor?.name ?? episode?.site ?? (classSeen ? (box?.site ?? null) : null),
        ...(episode ? { phase: "capturing", captured: episode.frames.length } : {}),
      });
    };

    Promise.all([loadSiteDetector(), loadAnchorEmbedder().catch(() => null)])
      .then(([detector, embedder]) => {
        if (stopped) return;
        clog("watch", "models loaded", { observer: observerId, embedder: Boolean(embedder), anchors: getAnchors().length });
        update({ phase: "watching", anchors: getAnchors().length });
        timer = window.setInterval(() => tick({ detector, embedder }), TICK_MS);
      })
      .catch((cause) => {
        clog("watch", "detector failed to load", { observer: observerId, error: String(cause).slice(0, 200) });
        update({ phase: "error" });
      });

    return () => {
      stopped = true;
      window.clearInterval(timer);
      unsubscribeCapture();
    };
  }, [enabled, observerId, videoRef, viewer]);

  return enabled ? watch : null;
}
