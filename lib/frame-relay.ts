import { log } from "@/lib/log";
import type { ObserverId } from "@/lib/types";

// Fallback video path for networks where phone and laptop cannot reach each
// other directly (venue wifi with client isolation, a phone on mobile data):
// the phone posts JPEG frames to this server over the same HTTPS tunnel it
// already uses, and the dashboard pulls them. Only the latest frame per
// observer is kept, in memory.

type Frame = { seq: number; at: number; capturedAt: number; jpeg: Uint8Array<ArrayBuffer> };
type Slot = { frame?: Frame; waiters: Set<(frame: Frame) => void> };

const globalStore = globalThis as typeof globalThis & {
  __openstateFrameRelay?: Map<ObserverId, Slot>;
};
const store = globalStore.__openstateFrameRelay ?? (globalStore.__openstateFrameRelay = new Map());

function slot(id: ObserverId) {
  let entry = store.get(id);
  if (!entry) {
    entry = { waiters: new Set() };
    store.set(id, entry);
  }
  return entry;
}

export const MAX_FRAME_BYTES = 400_000;
/** A frame older than this is a phone that has stopped sending. */
export const FRESH_MS = 3000;

export function putFrame(
  id: ObserverId,
  jpeg: Uint8Array<ArrayBuffer>,
  now = Date.now(),
  /** Phone clock at capture; uploads run in parallel and can arrive out of order. */
  capturedAt = now,
) {
  const entry = slot(id);
  // An older frame landing after a newer one would make the video jump back.
  const age = entry.frame ? now - entry.frame.at : Infinity;
  if (entry.frame && age >= 0 && age < FRESH_MS && capturedAt < entry.frame.capturedAt) {
    return entry.frame.seq;
  }
  if (!entry.frame || now - entry.frame.at > FRESH_MS) {
    log("relay", "phone started relaying frames", { observer: id, bytes: jpeg.length });
  }
  const frame = { seq: (entry.frame?.seq ?? 0) + 1, at: now, capturedAt, jpeg };
  entry.frame = frame;
  const waiting = [...entry.waiters];
  entry.waiters.clear();
  for (const wake of waiting) wake(frame);
  return frame.seq;
}

/** The next frame after `after`, waiting up to `timeoutMs` for one; null if none came. */
export function nextFrame(id: ObserverId, after: number, timeoutMs: number, now = Date.now()) {
  const entry = slot(id);
  const latest = entry.frame;
  // A sequence number from before a server restart is ahead of ours: resync.
  if (latest && latest.seq !== after && now - latest.at < FRESH_MS) {
    return Promise.resolve<Frame | null>(latest);
  }
  return new Promise<Frame | null>((resolve) => {
    const wake = (frame: Frame) => {
      clearTimeout(timer);
      resolve(frame);
    };
    const timer = setTimeout(() => {
      entry.waiters.delete(wake);
      resolve(null);
    }, timeoutMs);
    entry.waiters.add(wake);
  });
}
