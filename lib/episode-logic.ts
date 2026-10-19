import { alignedDifference, changedBlockFraction, nearDuplicate } from "@/lib/frame-diff";

// Decisions the watcher makes about one capture episode, kept free of browser
// APIs so they can be unit-tested: is something happening, is the episode
// over, and which frames are worth sending.

export const LOST_AFTER_MS = 3000;
export const MAX_EPISODE_MS = 60000;
export const KEYFRAMES = 6;
// Aligned mean-absolute-difference (0..255) between consecutive thumbnails
// that counts as a new keyframe. Camera jitter aligns away to ~0 and sensor
// noise sits around 3, so this only trips on real motion or lighting.
export const CHANGE_THRESHOLD = 12;
// Lower bar for "someone is doing something" (a hand reaching in). Either the
// whole frame moved this much, or at least one 8x8 block changed strongly.
export const ACTIVITY_THRESHOLD = 8;
// After activity, this much stillness means the hand has left: send now
// rather than waiting for the site to leave view or for MAX_EPISODE_MS, so a
// phone that keeps watching a table reports a taken can within seconds.
export const SETTLE_MS = 1500;

export type Thumb = Uint8Array | undefined;

/** Shift-tolerant difference so a drifting handheld camera does not read as change. */
export function difference(a: Thumb, b: Thumb) {
  if (!a || !b) return 0;
  return alignedDifference(a, b).delta;
}

/** True when the view changed enough between two samples to mean interaction. */
export function isActivity(a: Thumb, b: Thumb) {
  if (!a || !b) return false;
  const aligned = alignedDifference(a, b);
  return aligned.delta > ACTIVITY_THRESHOLD || changedBlockFraction(a, b, aligned) > 0;
}

export type EndReason = "lost" | "settled" | "timeout";

export function episodeEnd({
  now,
  startedAt,
  lastSeen,
  lastActivityAt,
}: {
  now: number;
  startedAt: number;
  lastSeen: number;
  /** When the view last changed during this episode; null if it never did. */
  lastActivityAt: number | null;
}): EndReason | null {
  if (now - lastSeen > LOST_AFTER_MS) return "lost";
  if (lastActivityAt !== null && now - lastActivityAt >= SETTLE_MS) return "settled";
  // Never cut an episode mid-reach: with a hand in view the last frame would
  // show the can still being lifted, and the still scene afterwards would not
  // be reported for another minute. Constant motion still ends eventually.
  const busy = lastActivityAt !== null && now - lastActivityAt < SETTLE_MS;
  if (now - startedAt > (busy ? 2 * MAX_EPISODE_MS : MAX_EPISODE_MS)) return "timeout";
  return null;
}

type Keyframe = { thumb?: Uint8Array; hash: string; seen?: boolean };

/** Removes the interior frame that adds the least over its predecessor. */
export function dropLeastChanged<T extends Keyframe>(frames: T[]) {
  let victim = 1;
  let smallest = Infinity;
  for (let i = 1; i < frames.length - 1; i++) {
    const delta = difference(frames[i].thumb, frames[i - 1].thumb);
    if (delta < smallest) {
      smallest = delta;
      victim = i;
    }
  }
  frames.splice(victim, 1);
}

/**
 * Up to KEYFRAMES frames: always the first and last (before and after), the
 * last frame where the site was seen, then the frames that differ most from
 * their predecessor, skipping near-duplicates of frames already chosen.
 */
export function pickKeyframes<T extends Keyframe>(frames: T[], limit = KEYFRAMES): T[] {
  if (frames.length <= limit) return frames;
  const last = frames.length - 1;
  const lastSeen = frames.findLastIndex((frame) => frame.seen);
  const picked = new Set<number>([0, last]);
  if (lastSeen > 0) picked.add(lastSeen);

  const isDuplicate = (index: number) =>
    [...picked].some((other) => nearDuplicate(frames[index].hash, frames[other].hash));
  const changes = frames
    .map((frame, index) => ({ index, delta: index ? difference(frame.thumb, frames[index - 1].thumb) : 0 }))
    .filter(({ index }) => index > 0 && !picked.has(index))
    .sort((a, b) => b.delta - a.delta);
  for (const { index } of changes) {
    if (picked.size >= limit) break;
    if (!isDuplicate(index)) picked.add(index);
  }
  return [...picked].sort((a, b) => a - b).map((index) => frames[index]);
}

export type Quality = { brightness: number; contrast: number; sharpness: number };

/**
 * How usable a frame is as a snapshot, from its grayscale thumbnail:
 * brightness (mean), contrast (standard deviation) and sharpness (mean
 * difference between neighbouring pixels, which motion blur flattens).
 */
export function frameQuality(thumb: Uint8Array, width = 32): Quality {
  let sum = 0;
  for (const value of thumb) sum += value;
  const brightness = sum / thumb.length;
  let variance = 0;
  let edges = 0;
  let pairs = 0;
  for (let index = 0; index < thumb.length; index++) {
    variance += (thumb[index] - brightness) ** 2;
    if ((index + 1) % width !== 0) {
      edges += Math.abs(thumb[index] - thumb[index + 1]);
      pairs += 1;
    }
    if (index + width < thumb.length) {
      edges += Math.abs(thumb[index] - thumb[index + width]);
      pairs += 1;
    }
  }
  return { brightness, contrast: Math.sqrt(variance / thumb.length), sharpness: pairs ? edges / pairs : 0 };
}

const MIN_BRIGHTNESS = 18;
const MIN_CONTRAST = 6;
// A frame this much softer than the episode's typical frame is motion blur.
const BLUR_RATIO = 0.55;

/**
 * Frames worth keeping as snapshots and sending to the model: not black, not
 * blank, not smeared by motion. Never returns fewer than two when two usable
 * frames exist, and falls back to the input rather than sending nothing.
 */
export function usableFrames<T extends { thumb?: Uint8Array }>(frames: T[]): T[] {
  const scored = frames.map((frame) => ({ frame, quality: frame.thumb ? frameQuality(frame.thumb) : null }));
  const lit = scored.filter(
    ({ quality }) => !quality || (quality.brightness >= MIN_BRIGHTNESS && quality.contrast >= MIN_CONTRAST),
  );
  if (lit.length === 0) return frames;
  const sharpness = lit.flatMap(({ quality }) => (quality ? [quality.sharpness] : [])).sort((a, b) => a - b);
  const typical = sharpness.length ? sharpness[Math.floor(sharpness.length / 2)] : 0;
  const sharp = lit.filter(({ quality }) => !quality || quality.sharpness >= typical * BLUR_RATIO);
  const kept = sharp.length >= 2 ? sharp : lit;
  return kept.map(({ frame }) => frame);
}
