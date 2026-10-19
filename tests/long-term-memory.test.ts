import { describe, expect, it } from "vitest";
import { formatRecalled, slug, type MemoryDoc } from "@/lib/long-term-memory";

const at = new Date("2026-10-11T15:31:00Z");
const doc = (kind: MemoryDoc["kind"], text: string, extra: Partial<MemoryDoc> = {}): MemoryDoc => ({
  kind,
  text,
  ts: at,
  ...extra,
});

describe("slug", () => {
  it("makes a stable lowercase handle", () => {
    expect(slug("Garage Fridge!")).toBe("garage-fridge");
    expect(slug("  Thilak's desk ")).toBe("thilak-s-desk");
    expect(slug("x".repeat(80))).toHaveLength(60);
  });
});

describe("formatRecalled", () => {
  it("groups by kind, in order, and labels turns", () => {
    const text = formatRecalled(
      [
        doc("episode", "table: 1 coke can taken"),
        doc("fact", "The wifi password is hunter2"),
        doc("term", "table: A table in the office that OPENSTATE watches."),
      ],
      [doc("turn", "how many cans", { role: "user" }), doc("turn", "Two.", { role: "assistant" })],
      10_000,
    );
    expect(text).toBe(
      [
        "Facts people asked to remember:",
        "- [2026-10-11 15:31] The wifi password is hunter2",
        "Past sightings:",
        "- [2026-10-11 15:31] table: 1 coke can taken",
        "Places and containers:",
        "- table: A table in the office that OPENSTATE watches.",
        "Earlier in this observer's conversation today:",
        "- They: how many cans",
        "- OPENSTATE: Two.",
      ].join("\n"),
    );
  });

  it("leaves out empty sections and stops at the budget", () => {
    // Heading (32 with newline) plus one 71-character line fit in 110; the second line does not.
    const text = formatRecalled([doc("fact", "a".repeat(50)), doc("fact", "b".repeat(50))], [], 110);
    expect(text).toBe(`Facts people asked to remember:\n- [2026-10-11 15:31] ${"a".repeat(50)}`);
    expect(formatRecalled([], [], 100)).toBe("");
  });
});
