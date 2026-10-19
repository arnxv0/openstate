import { describe, expect, it } from "vitest";
import {
  computeTrends,
  formatTrend,
  freshness,
  parseChange,
  shelfLifeDays,
  shoppingList,
  goingOff,
  type Change,
} from "@/lib/trends";

const now = new Date("2026-10-11T20:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const taken = (item: string, from: number, to: number, hours: number, by = "02"): Change => ({
  item,
  site: "table",
  from,
  to,
  at: ago(hours),
  by,
});

describe("parseChange", () => {
  it("reads a taken event", () => {
    const change = parseChange({
      ts: ago(1),
      title: "Taken",
      observerId: "02",
      metadata: { object: "coke can", from: "table", to: "Observer 02", detail: "3 → 2" },
    });
    expect(change).toMatchObject({ item: "coke can", site: "table", from: 3, to: 2, by: "02" });
  });

  it("takes the site from the destination of an added event", () => {
    const change = parseChange({
      ts: ago(1),
      title: "Added",
      metadata: { object: "milk", from: "Observer 01", to: "fridge", detail: "0 → 1" },
    });
    expect(change).toMatchObject({ item: "milk", site: "fridge", from: 0, to: 1 });
  });

  it("ignores events without counts", () => {
    expect(parseChange({ ts: now, title: "Taken", metadata: { object: "milk", from: "fridge" } })).toBeNull();
    expect(parseChange({ ts: now, title: "Voice" })).toBeNull();
  });
});

describe("computeTrends", () => {
  it("works out pace, time left and a running-low flag", () => {
    const [coke] = computeTrends(
      [taken("coke can", 6, 5, 48), taken("coke can", 5, 3, 24)],
      [{ site: "table", name: "coke can", count: 3, since: ago(72) }],
      now,
    );
    expect(coke.used).toBe(3);
    expect(coke.perDay).toBeCloseTo(1, 5); // 3 over 72 hours
    expect(coke.runsOutInMs).toBeCloseTo(3 * 86_400_000, -3);
    expect(coke.buy).toBeNull();
    expect(coke.lastTaken).toEqual({ at: ago(24), by: "02" });
  });

  it("flags an item that is used up, even though it is no longer in stock", () => {
    const trends = computeTrends([taken("coke can", 1, 0, 2)], [], now);
    expect(trends[0]).toMatchObject({ item: "coke can", inStock: 0, buy: "out" });
    expect(shoppingList(trends)).toEqual([
      { item: "coke can", site: "table", reason: "out", perDay: trends[0].perDay },
    ]);
  });

  it("does not turn one removal a minute ago into a huge daily rate", () => {
    const [coke] = computeTrends(
      [taken("coke can", 3, 2, 1 / 60)],
      [{ site: "table", name: "coke can", count: 2, since: ago(2 / 60) }],
      now,
    );
    expect(coke.trackedMs).toBe(3_600_000);
    expect(coke.perDay).toBe(24);
    expect(coke.buy).toBe("running low");
  });

  it("ignores changes outside the window and matches names case-insensitively", () => {
    const [coke] = computeTrends(
      [taken("Coke Can", 9, 8, 24 * 30), taken("Coke Can", 3, 2, 5)],
      [{ site: "Table", name: "coke can", count: 2 }],
      now,
    );
    expect(coke.used).toBe(1);
  });

  it("never tells you to buy a belonging that was merely picked up", () => {
    const trends = computeTrends([{ ...taken("laptop", 1, 0, 1), site: "chair" }], [], now);
    expect(trends[0]).toMatchObject({ item: "laptop", used: 1, buy: null });
    expect(shoppingList(trends)).toEqual([]);
  });

  it("puts what to buy first", () => {
    const trends = computeTrends(
      [taken("mustard", 1, 0, 3)],
      [{ site: "table", name: "apple", count: 4, since: ago(10) }],
      now,
    );
    expect(trends.map((trend) => trend.item)).toEqual(["mustard", "apple"]);
  });
});

describe("freshness", () => {
  it("guesses shelf life from the kind of item", () => {
    expect(shelfLifeDays("whole milk")).toBe(7);
    expect(shelfLifeDays("Strawberry")).toBe(5);
    expect(shelfLifeDays("cream cheese")).toBe(21);
    expect(shelfLifeDays("coke can")).toBeNull();
  });

  it("grades by age", () => {
    expect(freshness("milk", ago(24), now)?.status).toBe("fresh");
    expect(freshness("milk", ago(24 * 6), now)?.status).toBe("use soon");
    expect(freshness("milk", ago(24 * 9), now)?.status).toBe("likely past its best");
    expect(freshness("coke can", ago(24 * 90), now)).toBeNull();
  });

  it("lists what to use up, most overdue first", () => {
    const trends = computeTrends(
      [],
      [
        { site: "fridge", name: "milk", count: 1, since: ago(24 * 6) },
        { site: "fridge", name: "strawberry", count: 1, since: ago(24 * 8) },
        { site: "fridge", name: "cheese", count: 1, since: ago(24) },
      ],
      now,
    );
    expect(goingOff(trends).map((entry) => entry.item)).toEqual(["strawberry", "milk"]);
  });
});

describe("formatTrend", () => {
  it("reads as one line the answer model can quote", () => {
    const [coke] = computeTrends(
      [taken("coke can", 6, 3, 24)],
      [{ site: "table", name: "coke can", count: 3, since: ago(72) }],
      now,
    );
    expect(formatTrend(coke, () => "20:00")).toBe(
      "- coke can (table): 3 in stock; 3 used over 3 days (about 1 a day); runs out in about 3 days at this pace; last taken 20:00 by observer 02",
    );
  });
});
