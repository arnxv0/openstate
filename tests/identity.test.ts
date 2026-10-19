import { describe, expect, it } from "vitest";
import { resolveIdentity, uniqueName } from "@/lib/identity";
import { anchorHint, candidateLine, systemPrompt } from "@/lib/site-prompt";

const ask = (identity: string, confidence: number | undefined, trusted = true, candidates = 2) =>
  resolveIdentity({ identity, confidence, trusted, candidates });

describe("resolveIdentity", () => {
  it("matches a registered site by letter", () => {
    expect(ask("B", 0.9)).toEqual({ kind: "known", index: 1, confidence: 0.9 });
    expect(ask(" a ", 0.6)).toEqual({ kind: "known", index: 0, confidence: 0.6 });
  });
  it("stays unsure below 0.5 confidence or for a letter that does not exist", () => {
    expect(ask("A", 0.4).kind).toBe("unsure");
    expect(ask("C", 0.9).kind).toBe("unsure");
    expect(ask("new", 0.3).kind).toBe("unsure");
    expect(ask("unsure", 0.9).kind).toBe("unsure");
  });
  it("creates a new site on a confident 'new'", () => {
    expect(ask("new", 0.8)).toEqual({ kind: "new", confidence: 0.8 });
  });
  it("never trusts a lite model once something is registered", () => {
    expect(ask("A", 0.99, false)).toEqual({ kind: "unsure", confidence: 0 });
  });
  it("always creates the first site", () => {
    expect(ask("unsure", 0.1, true, 0).kind).toBe("new");
    expect(ask("A", 0.9, false, 0).kind).toBe("new");
  });
});

describe("uniqueName", () => {
  it("numbers a second site of the same kind", () => {
    expect(uniqueName("table", [])).toBe("table");
    expect(uniqueName("table", ["table", "table 2"])).toBe("table 3");
  });
});

describe("site prompt", () => {
  it("names the site kind and asks for counts", () => {
    const prompt = systemPrompt("table");
    expect(prompt).toContain("showing a table");
    expect(prompt).toContain('"count":3');
    expect(prompt).toContain("contentsVisible");
  });
  it("lists a candidate's counted contents", () => {
    const line = candidateLine(
      { name: "table", place: "office", items: [{ name: "coke can", count: 3 }], lastSeen: "12:00:00", lastObserver: "01", references: 1 },
      0,
    );
    expect(line).toContain("CANDIDATE A: table (office)");
    expect(line).toContain("coke can ×3");
    expect(line).toContain("Reference photos:");
  });
  it("hints the matched anchor only when it is a candidate", () => {
    expect(anchorHint("table", ["fridge", "table"])).toContain("candidate B");
    expect(anchorHint("shelf", ["fridge", "table"])).toBeNull();
  });
});
