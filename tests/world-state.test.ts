import { describe, expect, it } from "vitest";
import { formatSite, formatWorldState, type SiteState } from "@/lib/world-state";

const clock = (date: Date) => date.toISOString().slice(11, 16);
const at = (time: string) => new Date(`2026-10-11T${time}:00Z`);

const table: SiteState = {
  name: "table",
  place: "office",
  items: [
    { name: "coke can", count: 2, since: at("12:00"), by: "02" },
    { name: "notebook", count: 1, since: at("12:00"), by: "01" },
  ],
  lastSeen: at("12:05"),
  lastObserver: "02",
  lastChange: { summary: "-1 coke can (3→2)", by: "02", at: at("12:05") },
};

describe("formatWorldState", () => {
  it("gives the count, who touched it and the last change", () => {
    const line = formatSite(table, clock);
    expect(line).toContain("- table (office): coke can ×2 [since 12:00, last touched by observer 02]");
    expect(line).toContain("notebook [since 12:00, last touched by observer 01]");
    expect(line).toContain("3 things in total");
    expect(line).toContain("last checked 12:05 by observer 02");
    expect(line).toContain("last change: -1 coke can (3→2) seen by observer 02 at 12:05");
  });
  it("says empty and not-seen-yet explicitly", () => {
    expect(formatSite({ ...table, items: [], lastChange: undefined }, clock)).toContain("table (office): empty;");
    expect(formatSite({ ...table, catalogued: false }, clock)).toContain("contents not seen yet");
  });
  it("handles no sites and several sites", () => {
    expect(formatWorldState([])).toBe("- nothing catalogued yet");
    expect(formatWorldState([table, { ...table, name: "fridge" }], clock).split("\n")).toHaveLength(2);
  });
});
