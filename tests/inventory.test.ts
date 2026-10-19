import { describe, expect, it } from "vitest";
import {
  canonicalName,
  formatDelta,
  formatItems,
  parseInventory,
  partialTarget,
  reconcile,
  totalCount,
  withCounts,
  type Item,
} from "@/lib/inventory";

const T0 = new Date("2026-10-11T10:00:00Z");
const T1 = new Date("2026-10-11T10:05:00Z");
const item = (name: string, count: number): Item => ({ name, count, since: T0, by: "01" });

describe("parseInventory", () => {
  it("reads counted objects", () => {
    expect(parseInventory([{ name: "Coke Can", count: 3 }, { name: "mustard", count: 1 }])).toEqual([
      { name: "coke can", count: 3 },
      { name: "mustard", count: 1 },
    ]);
  });
  it("counts repeated strings and merges duplicates", () => {
    expect(parseInventory(["coke can", "coke can", { name: "coke can", quantity: 2 }])).toEqual([
      { name: "coke can", count: 4 },
    ]);
  });
  it("drops zero counts and junk, and returns null when contents were not seen", () => {
    expect(parseInventory([{ name: "milk", count: 0 }, { name: " " }, 7, null])).toEqual([]);
    expect(parseInventory(null)).toBeNull();
    expect(parseInventory("coke")).toBeNull();
  });
  it("reuses the known spelling across a plural s", () => {
    expect(parseInventory([{ name: "coke cans", count: 2 }], ["coke can"])).toEqual([
      { name: "coke can", count: 2 },
    ]);
    expect(canonicalName("Egg", ["eggs"])).toBe("eggs");
  });
});

describe("reconcile", () => {
  it("records one can taken from three by the observer who saw it", () => {
    const { items, deltas } = reconcile(
      [item("coke can", 3), item("mustard", 1)],
      [
        { name: "coke can", count: 2 },
        { name: "mustard", count: 1 },
      ],
      "02",
      T1,
    );
    expect(deltas).toEqual([{ name: "coke can", from: 3, to: 2 }]);
    expect(items).toEqual([
      { name: "coke can", count: 2, since: T0, by: "02" },
      { name: "mustard", count: 1, since: T0, by: "01" },
    ]);
  });
  it("drops an item that is gone and adds a new one, removals first", () => {
    const { items, deltas } = reconcile([item("coke can", 1)], [{ name: "apple", count: 2 }], "02", T1);
    expect(deltas).toEqual([
      { name: "coke can", from: 1, to: 0 },
      { name: "apple", from: 0, to: 2 },
    ]);
    expect(items).toEqual([{ name: "apple", count: 2, since: T1, by: "02" }]);
  });
  it("reports nothing when nothing changed", () => {
    const current = [item("coke can", 2)];
    const result = reconcile(current, [{ name: "coke can", count: 2 }], "02", T1);
    expect(result.deltas).toEqual([]);
    expect(result.items).toEqual(current);
  });
});

describe("formatting", () => {
  it("formats deltas", () => {
    expect(formatDelta({ name: "coke can", from: 3, to: 2 })).toBe("-1 coke can (3→2)");
    expect(formatDelta({ name: "coke can", from: 2, to: 0 })).toBe("-2 coke can");
    expect(formatDelta({ name: "milk", from: 0, to: 2 })).toBe("+2 milk");
  });
  it("formats items and totals", () => {
    expect(formatItems([item("coke can", 2), item("mustard", 1)])).toBe("coke can ×2, mustard");
    expect(formatItems([])).toBe("empty");
    expect(totalCount([item("coke can", 2), item("mustard", 1)])).toBe(3);
  });
  it("treats items stored before counts existed as one each", () => {
    expect(withCounts([{ name: "milk", since: T0, by: "01" }])).toEqual([item("milk", 1)]);
  });
});

describe("partialTarget", () => {
  const known = [item("coke can", 3), item("mustard", 1)];
  it("does not remove what is merely out of frame", () => {
    expect(partialTarget(known, [{ name: "mustard", count: 1 }])).toEqual([
      { name: "coke can", count: 3 },
      { name: "mustard", count: 1 },
    ]);
  });
  it("applies a removal that was seen happening", () => {
    const target = partialTarget(known, [{ name: "coke can", count: 2 }], [{ name: "coke can", count: 1 }]);
    expect(target).toContainEqual({ name: "coke can", count: 2 });
    expect(reconcile(known, target, "02", T1).deltas).toEqual([{ name: "coke can", from: 3, to: 2 }]);
  });
  it("never goes below what is still visible, and drops an item taken to zero", () => {
    expect(partialTarget(known, [{ name: "coke can", count: 3 }], [{ name: "coke can", count: 2 }])).toContainEqual({
      name: "coke can",
      count: 3,
    });
    expect(partialTarget(known, [], [{ name: "mustard", count: 1 }])).toEqual([{ name: "coke can", count: 3 }]);
  });
  it("adds new items and higher counts", () => {
    expect(
      partialTarget(known, [
        { name: "coke can", count: 4 },
        { name: "apple", count: 2 },
      ]),
    ).toEqual([
      { name: "coke can", count: 4 },
      { name: "mustard", count: 1 },
      { name: "apple", count: 2 },
    ]);
  });
});

describe("canonicalName across synonyms", () => {
  it("keeps one name for the same can said differently", async () => {
    const { canonicalName, itemKey, parseInventory, reconcile } = await import("@/lib/inventory");
    const known = ["coke can", "orange juice"];
    expect(canonicalName("soda can", known)).toBe("coke can");
    expect(canonicalName("Cans of Coca-Cola", known)).toBe("coke can");
    expect(canonicalName("cola cans", known)).toBe("coke can");
    expect(itemKey("can of coke")).toBe("coke can");
    // A taken can reads as -1, not as "-3 coke can, +2 soda can".
    const now = new Date();
    const current = [{ name: "coke can", count: 3, since: now, by: "01" as const }];
    const seen = parseInventory([{ name: "soda can", count: 2 }], ["coke can"])!;
    expect(reconcile(current, seen, "02", now).deltas).toEqual([{ name: "coke can", from: 3, to: 2 }]);
  });

  it("does not merge different things", async () => {
    const { canonicalName } = await import("@/lib/inventory");
    const known = ["coke can", "orange juice"];
    expect(canonicalName("apple juice", known)).toBe("apple juice");
    expect(canonicalName("beer can", known)).toBe("beer can");
    expect(canonicalName("diet coke", known)).toBe("diet coke");
    expect(canonicalName("glass", known)).toBe("glass");
  });

  it("leaves an ambiguous name alone", async () => {
    const { canonicalName } = await import("@/lib/inventory");
    expect(canonicalName("soda can", ["coke can", "cola can"])).toBe("soda can");
  });
});

describe("parseInventory and people", () => {
  it("never counts a person or a hand as something kept at a site", async () => {
    const { parseInventory } = await import("@/lib/inventory");
    expect(parseInventory([{ name: "laptop", count: 1 }, { name: "Person", count: 1 }, "hand"])).toEqual([
      { name: "laptop", count: 1 },
    ]);
  });
});
