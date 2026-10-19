import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasRocketRide, pipePath, resultText, tools, uri } from "@/lib/sponsors/rocketride";

afterEach(() => vi.unstubAllEnvs());

describe("openstate-ops.pipe", () => {
  it("is a webhook → tool_n8n → response_text pipeline", () => {
    const pipe = JSON.parse(readFileSync("rocketride/openstate-ops.pipe", "utf8")) as {
      source: string;
      components: { id: string; provider: string; input?: { lane: string; from: string }[]; config: Record<string, unknown> }[];
    };
    expect(pipe.components.map((c) => c.provider)).toEqual(["webhook", "tool_n8n", "response_text"]);
    expect(pipe.source).toBe(pipe.components[0].id);
    expect(pipe.components[1].input).toEqual([{ lane: "text", from: pipe.components[0].id }]);
    expect(pipe.components[2].input).toEqual([{ lane: "text", from: pipe.components[1].id }]);
    expect(pipe.components[1].config.workflow).toBe("openstate-ops");
    expect(pipe.components[1].config.baseUrl).toBe("${ROCKETRIDE_N8N_URL}");
  });
});

describe("config", () => {
  it("defaults the cloud uri and the pipe path, and is unconfigured without a key", () => {
    vi.stubEnv("ROCKETRIDE_APIKEY", "");
    vi.stubEnv("ROCKETRIDE_URI", "");
    vi.stubEnv("ROCKETRIDE_PIPE", "");
    expect(hasRocketRide()).toBe(false);
    expect(tools()).toEqual([]);
    expect(uri()).toBe("https://api.rocketride.ai");
    expect(pipePath().endsWith("rocketride/openstate-ops.pipe")).toBe(true);
  });

  it("offers the ops tool once a key is set", () => {
    vi.stubEnv("ROCKETRIDE_APIKEY", "rr_test");
    expect(tools().map((tool) => tool.name)).toEqual(["run_ops_pipeline"]);
  });
});

describe("resultText", () => {
  it("reads the text lane from whatever the engine returned", () => {
    expect(resultText("  ok ")).toBe("ok");
    expect(resultText({ text: "Logged with operations" })).toBe("Logged with operations");
    expect(resultText({ name: "x", path: "", objectId: "y" })).toBe('{"name":"x","path":"","objectId":"y"}');
    expect(resultText(undefined)).toBe("");
  });
});
