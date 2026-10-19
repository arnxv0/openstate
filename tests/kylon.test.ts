import { afterEach, describe, expect, it, vi } from "vitest";
import { formatResult, formatSearch, tools } from "@/lib/sponsors/kylon";

afterEach(() => vi.unstubAllEnvs());

describe("formatSearch", () => {
  it("lists slugs with toolkit and trimmed descriptions", () => {
    const text = formatSearch({
      tools: [
        { slug: "GOOGLETASKS_INSERT_TASK", toolkit: "googletasks", description: "Creates   a task\nin a list" },
        { name: "SLACK_SEND_MESSAGE" },
        { description: "no slug" },
      ],
    });
    expect(text).toBe("GOOGLETASKS_INSERT_TASK [googletasks] — Creates a task in a list\nSLACK_SEND_MESSAGE");
  });

  it("caps the list and says when nothing matches", () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ slug: `T${index}` }));
    const text = formatSearch(many);
    expect(text.split("\n")).toHaveLength(21);
    expect(text.endsWith("… 5 more")).toBe(true);
    expect(formatSearch({ results: [] })).toBe("No tools match.");
    expect(formatSearch(null)).toBe("No tools match.");
  });
});

describe("formatResult", () => {
  it("spells failures out and returns data as JSON", () => {
    expect(formatResult({ successful: false, error: "not connected" })).toBe("The action failed: not connected");
    expect(formatResult({ success: false })).toBe("The action failed.");
    expect(formatResult({ successful: true, data: { id: 1 } })).toBe('{"id":1}');
    expect(formatResult({ ok: 1 })).toBe('{"ok":1}');
  });

  it("truncates very long results", () => {
    const text = formatResult({ data: { big: "z".repeat(10_000) } });
    expect(text.length).toBeLessThan(6100);
    expect(text.endsWith("… (truncated)")).toBe(true);
  });
});

describe("tools", () => {
  it("offers nothing without a key, and the two actions with one", () => {
    vi.stubEnv("KYLON_API_KEY", "");
    expect(tools()).toEqual([]);
    vi.stubEnv("KYLON_API_KEY", "pak_test");
    expect(tools().map((tool) => tool.name)).toEqual(["search_app_tools", "run_app_tool"]);
  });
});
