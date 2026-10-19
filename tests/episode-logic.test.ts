import { describe, expect, it } from "vitest";
import {
  KEYFRAMES,
  LOST_AFTER_MS,
  MAX_EPISODE_MS,
  SETTLE_MS,
  dropLeastChanged,
  episodeEnd,
  isActivity,
  pickKeyframes,
} from "@/lib/episode-logic";
import { THUMB_H as H, THUMB_W as W, dHash } from "@/lib/frame-diff";

/** A table top with `cans` bright cans on it and optionally an arm reaching in. */
function table(cans: number, { arm = false, shift = 0 } = {}) {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x - shift;
      let value = 60 + sx + y * 2;
      for (let c = 0; c < cans; c++) {
        const left = 4 + c * 8;
        if (sx >= left && sx < left + 4 && y >= 8 && y < 16) value = 230;
      }
      if (arm && y >= 10 && y < 22 && sx >= 12) value = 20;
      gray[y * W + x] = Math.max(0, Math.min(255, value));
    }
  }
  return gray;
}
const frame = (thumb: Uint8Array, seen = true) => ({ thumb, hash: dHash(thumb), seen });

describe("isActivity", () => {
  it("is quiet for the same view and for a small camera shift", () => {
    expect(isActivity(table(3), table(3))).toBe(false);
    expect(isActivity(table(3), table(3, { shift: 1 }))).toBe(false);
  });
  it("fires when an arm reaches in", () => {
    expect(isActivity(table(3), table(3, { arm: true }))).toBe(true);
  });
  it("needs both thumbnails", () => {
    expect(isActivity(undefined, table(3))).toBe(false);
  });
});

describe("episodeEnd", () => {
  const base = { startedAt: 0, lastSeen: 10_000, lastActivityAt: null };
  it("keeps going while the site is in view and nothing settled", () => {
    expect(episodeEnd({ ...base, now: 10_500 })).toBeNull();
  });
  it("ends when the site has left view", () => {
    expect(episodeEnd({ ...base, now: 10_000 + LOST_AFTER_MS + 1 })).toBe("lost");
  });
  it("ends shortly after activity stops, without waiting for the site to leave view", () => {
    const moving = { startedAt: 0, lastSeen: 9_900, lastActivityAt: 8_000 };
    expect(episodeEnd({ ...moving, now: 8_000 + SETTLE_MS - 1 })).toBeNull();
    expect(episodeEnd({ ...moving, lastSeen: 8_000 + SETTLE_MS, now: 8_000 + SETTLE_MS })).toBe("settled");
  });
  it("times out a long still episode", () => {
    expect(episodeEnd({ startedAt: 0, lastSeen: MAX_EPISODE_MS, lastActivityAt: null, now: MAX_EPISODE_MS + 1 })).toBe(
      "timeout",
    );
  });
});

describe("pickKeyframes", () => {
  it("returns short episodes untouched", () => {
    const frames = [frame(table(3)), frame(table(2))];
    expect(pickKeyframes(frames)).toBe(frames);
  });
  it("keeps the first and last frame and the moment of change", () => {
    const frames = [
      ...Array.from({ length: 5 }, () => frame(table(3))),
      frame(table(3, { arm: true })),
      ...Array.from({ length: 5 }, () => frame(table(2))),
    ];
    const picked = pickKeyframes(frames);
    expect(picked.length).toBeLessThanOrEqual(KEYFRAMES);
    expect(picked[0]).toBe(frames[0]);
    expect(picked.at(-1)).toBe(frames.at(-1));
    expect(picked).toContain(frames[5]);
  });
  it("dropLeastChanged removes an interior duplicate, never the ends", () => {
    const frames = [frame(table(3)), frame(table(3)), frame(table(3, { arm: true })), frame(table(2))];
    const [first, , arm, last] = frames;
    dropLeastChanged(frames);
    expect(frames).toEqual([first, arm, last]);
  });
});

describe("episodeEnd timeout", () => {
  it("does not cut an episode while a hand is still moving", async () => {
    const { episodeEnd, MAX_EPISODE_MS } = await import("@/lib/episode-logic");
    const startedAt = 0;
    const now = MAX_EPISODE_MS + 500;
    expect(episodeEnd({ now, startedAt, lastSeen: now, lastActivityAt: now - 400 })).toBeNull();
    expect(episodeEnd({ now, startedAt, lastSeen: now, lastActivityAt: null })).toBe("timeout");
    const late = 2 * MAX_EPISODE_MS + 500;
    expect(episodeEnd({ now: late, startedAt, lastSeen: late, lastActivityAt: late - 400 })).toBe("timeout");
  });
});

describe("usableFrames", () => {
  const thumb = (fill: (index: number) => number) => Uint8Array.from({ length: 32 * 24 }, (_, index) => fill(index));
  const sharp = () => thumb((index) => ((index % 32) % 2 === 0 ? 40 : 200));
  const blurred = () => thumb((index) => 110 + ((index % 32) / 32) * 20);
  const black = () => thumb(() => 2);

  it("drops black and motion-blurred frames", async () => {
    const { usableFrames } = await import("@/lib/episode-logic");
    const frames = [
      { id: "black", thumb: black() },
      { id: "a", thumb: sharp() },
      { id: "blur", thumb: blurred() },
      { id: "b", thumb: sharp() },
      { id: "c", thumb: sharp() },
    ];
    expect(usableFrames(frames).map((frame) => frame.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps soft frames when that is all there is, and never returns nothing", async () => {
    const { usableFrames } = await import("@/lib/episode-logic");
    expect(usableFrames([{ id: "x", thumb: blurred() }, { id: "y", thumb: blurred() }]).length).toBe(2);
    expect(usableFrames([{ id: "dark", thumb: black() }]).length).toBe(1);
    expect(usableFrames([{ id: "no-thumb", thumb: undefined }]).length).toBe(1);
  });
});
