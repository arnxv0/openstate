import { describe, expect, it } from "vitest";
import {
  MATCH_ENTER,
  MATCH_EXIT,
  anchorSeen,
  bestMatch,
  cosine,
  dominantAnchor,
  type Anchor,
} from "@/lib/anchor-match";
import { DETECTOR_CLASSES, siteKind } from "@/lib/site-kinds";

const unit = (x: number, y: number) => {
  const n = Math.hypot(x, y);
  return [x / n, y / n];
};
const anchor = (name: string, ...embeddings: number[][]): Anchor => ({
  key: `anchor:${name}`,
  name,
  container: name,
  references: embeddings.map((embedding) => ({ embedding, hash: "0".repeat(16) })),
});
const table = anchor("table", unit(1, 0), unit(0.9, 0.1));
const fridge = anchor("fridge", unit(0, 1));

describe("bestMatch", () => {
  it("returns the closest anchor across all references and variants", () => {
    const match = bestMatch([table, fridge], [unit(0.2, 1), unit(1, 0.05)]);
    expect(match?.anchor.name).toBe("table");
    expect(match?.similarity).toBeGreaterThan(0.99);
  });
  it("is null with no anchors or no embeddings", () => {
    expect(bestMatch([], [unit(1, 0)])).toBeNull();
    expect(bestMatch([table], [])).toBeNull();
  });
  it("cosine of unit vectors is their dot product", () => {
    expect(cosine(unit(1, 0), unit(0, 1))).toBeCloseTo(0);
    expect(cosine(unit(1, 1), unit(1, 1))).toBeCloseTo(1);
  });
});

describe("anchorSeen", () => {
  const at = (similarity: number) => ({ anchor: table, similarity });
  it("needs the enter threshold to start and only the exit threshold to continue", () => {
    const between = (MATCH_ENTER + MATCH_EXIT) / 2;
    expect(anchorSeen(at(between), false)).toBe(false);
    expect(anchorSeen(at(between), true)).toBe(true);
    expect(anchorSeen(at(MATCH_ENTER), false)).toBe(true);
    expect(anchorSeen(at(MATCH_EXIT - 0.01), true)).toBe(false);
    expect(anchorSeen(null, true)).toBe(false);
  });
});

describe("dominantAnchor", () => {
  it("picks the anchor seen most in the trigger window", () => {
    expect(dominantAnchor([table, null, fridge, table])).toBe(table);
    expect(dominantAnchor([null, null])).toBeNull();
  });
});

describe("siteKind", () => {
  it("maps detector classes to everyday words", () => {
    expect(siteKind("refrigerator")).toBe("fridge");
    expect(siteKind("Dining Table")).toBe("table");
    expect(siteKind("bookshelf")).toBe("bookshelf");
    expect(siteKind(null)).toBeNull();
    expect(DETECTOR_CLASSES).toEqual(["refrigerator", "dining table"]);
  });
});
