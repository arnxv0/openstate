import { describe, expect, it } from "vitest";
import { expand, toolsFor } from "@/lib/company/tools";
import { agent } from "@/lib/company/roster";
import { parseServers, resultText, toolName } from "@/lib/sponsors/mcp";
import type { AgentTool } from "@/lib/tools";

describe("parseServers", () => {
  it("reads http and stdio targets and drops malformed entries", () => {
    expect(parseServers("rocketride=https://api.rocketride.ai/mcp, Tenki=stdio:npx -y @tenkicloud/mcp ,bad,=x,y=")).toEqual([
      { name: "rocketride", kind: "http", target: "https://api.rocketride.ai/mcp" },
      { name: "tenki", kind: "stdio", target: "npx -y @tenkicloud/mcp" },
    ]);
    expect(parseServers("n8n=ftp://nope")).toEqual([]);
    expect(parseServers("")).toEqual([]);
  });
});

describe("toolName and resultText", () => {
  it("prefixes and sanitises tool names", () => {
    expect(toolName("tenki", "tenki_run_code")).toBe("mcp_tenki_tenki_run_code");
    expect(toolName("n8n", "create invoice!")).toBe("mcp_n8n_create_invoice_");
  });

  it("joins text parts, flags errors and clips long output", () => {
    expect(resultText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb");
    expect(resultText({ content: [{ type: "text", text: "boom" }], isError: true })).toBe("The tool failed: boom");
    expect(resultText({ structuredContent: { ok: 1 } })).toBe('{"ok":1}');
    expect(resultText({ content: [] })).toBe("(no output)");
    expect(resultText({ content: [{ type: "text", text: "x".repeat(9000) }] }).endsWith("… (truncated)")).toBe(true);
  });
});

describe("mcp:<server> expansion", () => {
  const tool = (name: string): AgentTool => ({ name, description: name, parameters: { type: "object", properties: {} }, run: async () => "" });
  const names = ["recall_memory", "mcp_tenki_tenki_run_code", "mcp_tenki_tenki_exec", "mcp_rocketride_run_pipeline"];

  it("expands a server prefix, a wildcard, and leaves plain names alone", () => {
    expect(expand("mcp:tenki", names)).toEqual(["mcp_tenki_tenki_run_code", "mcp_tenki_tenki_exec"]);
    expect(expand("mcp:*", names)).toHaveLength(3);
    expect(expand("recall_memory", names)).toEqual(["recall_memory"]);
    expect(expand("mcp:n8n", names)).toEqual([]);
  });

  it("gives the Research Analyst the Tenki MCP tools and reports Celesto as missing", () => {
    const box = new Map(names.map((name) => [name, tool(name)]));
    const scout = toolsFor(agent("scout"), box);
    expect(scout.available.map((t) => t.name)).toEqual(["recall_memory", "mcp_tenki_tenki_run_code", "mcp_tenki_tenki_exec"]);
    expect(scout.missing).toEqual(["research_web", "run_python", "mcp:celesto"]);
  });
});
