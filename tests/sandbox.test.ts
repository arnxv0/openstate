import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTRACT_PROMPT, SEARCH_SCRIPT } from "@/lib/sponsors/research";
import { hasSandbox, provider, pythonCommand } from "@/lib/sponsors/sandbox";

afterEach(() => vi.unstubAllEnvs());

function env(values: Record<string, string>) {
  for (const key of ["TENKI_API_KEY", "CELESTO_API_KEY", "SANDBOX_PROVIDER"]) vi.stubEnv(key, values[key] ?? "");
}

describe("provider", () => {
  it("is null without keys, Tenki first when both are set", () => {
    env({});
    expect(provider()).toBeNull();
    expect(hasSandbox()).toBe(false);
    env({ CELESTO_API_KEY: "c" });
    expect(provider()).toBe("celesto");
    env({ TENKI_API_KEY: "t", CELESTO_API_KEY: "c" });
    expect(provider()).toBe("tenki");
  });

  it("honours SANDBOX_PROVIDER only when that key is set", () => {
    env({ TENKI_API_KEY: "t", CELESTO_API_KEY: "c", SANDBOX_PROVIDER: "celesto" });
    expect(provider()).toBe("celesto");
    env({ TENKI_API_KEY: "t", SANDBOX_PROVIDER: "celesto" });
    expect(provider()).toBe("tenki");
  });
});

describe("pythonCommand", () => {
  const decode = (line: string) => Buffer.from(/echo (\S+) \| base64/.exec(line)![1], "base64").toString("utf8");

  it("lands the script and files base64-encoded, then runs python3", () => {
    const script = `print("it's $HOME <<'EOF'")\n`;
    const command = pythonCommand(script, { "query.txt": "milk shelf life" });
    const lines = command.split("\n");
    expect(lines.slice(0, 3)).toEqual(["set -e", "mkdir -p /tmp/job", "cd /tmp/job"]);
    expect(lines[3]).toMatch(/> query\.txt$/);
    expect(decode(lines[3])).toBe("milk shelf life");
    expect(lines[4]).toMatch(/> job\.py$/);
    expect(decode(lines[4])).toBe(script);
    expect(lines.at(-1)).toBe("python3 job.py");
    expect(command).not.toContain("$HOME");
  });

  it("refuses file names that could escape the job directory", () => {
    expect(() => pythonCommand("x", { "../etc/passwd": "y" })).toThrow(/unsafe file name/);
    expect(() => pythonCommand("x", { "a b": "y" })).toThrow(/unsafe file name/);
  });
});

describe("search script", () => {
  it("searches DuckDuckGo from query.txt and prints JSON results", () => {
    expect(SEARCH_SCRIPT).toContain("https://html.duckduckgo.com/html/?q=");
    expect(SEARCH_SCRIPT).toContain('open("query.txt"');
    expect(SEARCH_SCRIPT).toContain("uddg");
    expect(SEARCH_SCRIPT).toContain('print(json.dumps({"results": results}))');
    expect(SEARCH_SCRIPT).not.toMatch(/^import (requests|bs4)/m);
  });

  it("asks the model for the JSON the tool parses", () => {
    expect(EXTRACT_PROMPT).toContain('"confidence": "high" | "medium" | "low"');
    expect(EXTRACT_PROMPT).toContain('"sources"');
  });
});
