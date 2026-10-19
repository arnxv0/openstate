import { describe, expect, it } from "vitest";
import {
  THUMB_H as H,
  THUMB_W as W,
  alignedDifference,
  allCovered,
  changedBlockFraction,
  dHash,
  hamming,
  nearDuplicate,
} from "@/lib/frame-diff";

/** Gradient background with one bright 8x12 "item"; rectX < 0 removes it. */
function scene(rectX: number, { brightness = 0, shift = 0 } = {}) {
  const gray = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x - shift;
      let value = 40 + sx * 4 + y * 2;
      if (sx >= rectX && sx < rectX + 8 && y >= 6 && y < 18) value = 220;
      gray[y * W + x] = Math.max(0, Math.min(255, value + brightness));
    }
  }
  return gray;
}

const base = scene(10);

describe("dHash", () => {
  it("is 16 hex chars and stable for the same frame", () => {
    expect(dHash(base)).toMatch(/^[0-9a-f]{16}$/);
    expect(hamming(dHash(base), dHash(scene(10)))).toBe(0);
  });
  it("ignores a brightness change but not a removed item", () => {
    expect(nearDuplicate(dHash(base), dHash(scene(10, { brightness: 25 })))).toBe(true);
    expect(hamming(dHash(base), dHash(scene(-100)))).toBeGreaterThan(4);
  });
  it("allCovered needs every hash matched", () => {
    const a = dHash(base);
    const b = dHash(scene(-100));
    expect(allCovered([a], [a, b])).toBe(true);
    expect(allCovered([a, b], [a])).toBe(false);
  });
});

describe("alignedDifference", () => {
  it("aligns away a 2px camera shift", () => {
    const shifted = alignedDifference(base, scene(10, { shift: 2 }));
    expect(shifted.delta).toBeLessThan(1);
    expect(Math.abs(shifted.dx)).toBe(2);
  });
  it("still sees an item that moved or vanished", () => {
    expect(alignedDifference(base, scene(20)).delta).toBeGreaterThan(8);
    const gone = alignedDifference(base, scene(-100));
    expect(gone.delta).toBeGreaterThan(8);
    expect(changedBlockFraction(base, scene(-100), gone)).toBeGreaterThan(0);
  });
});
