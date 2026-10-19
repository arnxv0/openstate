import type { ObserverId } from "@/lib/types";

// A question that arrives while a change is still being worked out must not
// be answered from the old state. Two things can be outstanding: an episode
// the model is reading right now, and one the dashboard is still capturing
// after it saw movement (it announces that through /api/episodes/pending).

type Store = { inFlight: number; expected: Map<ObserverId, number>; waiters: Set<() => void> };

const globalStore = globalThis as typeof globalThis & { __openstateEpisodeQueue?: Store };
const store: Store =
  globalStore.__openstateEpisodeQueue ??
  (globalStore.__openstateEpisodeQueue = { inFlight: 0, expected: new Map(), waiters: new Set() });

/** How long after movement an upload is still expected (settle time plus upload). */
export const EXPECT_MS = 6000;

function wake() {
  const waiting = [...store.waiters];
  store.waiters.clear();
  for (const resume of waiting) resume();
}

/** The dashboard saw movement at a site: an episode from this observer will follow. */
export function expectEpisode(observerId: ObserverId, now = Date.now()) {
  store.expected.set(observerId, now + EXPECT_MS);
}

export function episodeStarted(observerId: ObserverId) {
  store.expected.delete(observerId);
  store.inFlight += 1;
}

export function episodeFinished() {
  store.inFlight = Math.max(0, store.inFlight - 1);
  wake();
}

export function outstanding(now = Date.now()) {
  for (const [id, until] of store.expected) if (until <= now) store.expected.delete(id);
  return { inFlight: store.inFlight, expected: store.expected.size };
}

/**
 * Resolves once nothing is outstanding, or after `timeoutMs`. Returns how
 * long it waited, so callers can log when an answer was held back.
 */
export async function episodesSettled(timeoutMs = 9000) {
  const started = Date.now();
  for (;;) {
    const now = Date.now();
    const { inFlight, expected } = outstanding(now);
    const left = timeoutMs - (now - started);
    if ((inFlight === 0 && expected === 0) || left <= 0) return now - started;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        store.waiters.delete(done);
        resolve();
      }, Math.min(left, 250));
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      store.waiters.add(done);
    });
  }
}

/** Test helper. */
export function resetEpisodeQueue() {
  store.inFlight = 0;
  store.expected.clear();
  wake();
}
