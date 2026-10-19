import { describe, expect, it } from "vitest";
import { parsePlan } from "@/lib/company/dispatch";
import { agent, ROSTER, SPECIALISTS } from "@/lib/company/roster";
import { toolsFor } from "@/lib/company/tools";
import type { AgentTool } from "@/lib/tools";

describe("roster", () => {
  it("has six agents with distinct roles and the four specialists", () => {
    expect(ROSTER).toHaveLength(6);
    expect(new Set(ROSTER.map((a) => a.title)).size).toBe(6);
    expect(SPECIALISTS.map((a) => a.key)).toEqual(["eyes", "ledger", "scout", "runner"]);
    expect(agent("host").tools).toEqual([]);
  });
});

describe("parsePlan", () => {
  it("keeps valid assignments, drops unknown agents and duplicates, caps at three", () => {
    const plan = parsePlan({
      reason: "needs the list and an action",
      assignments: [
        { agent: "eyes", task: "count the table" },
        { agent: "ceo", task: "nope" },
        { agent: "eyes", task: "again" },
        { agent: "runner", task: "add to the list" },
        { agent: "scout", task: "check recalls" },
        { agent: "ledger", task: "fourth" },
      ],
    });
    expect(plan.reason).toBe("needs the list and an action");
    expect(plan.assignments).toEqual([
      { agent: "eyes", task: "count the table" },
      { agent: "runner", task: "add to the list" },
      { agent: "scout", task: "check recalls" },
    ]);
  });

  it("tolerates garbage", () => {
    expect(parsePlan(null)).toEqual({ reason: "", assignments: [] });
    expect(parsePlan({ assignments: [{ agent: "eyes" }, "x", { agent: "scout", task: "  " }] }).assignments).toEqual([]);
  });
});

describe("toolsFor", () => {
  const tool = (name: string): AgentTool => ({ name, description: name, parameters: { type: "object", properties: {} }, run: async () => "" });

  it("gives an agent what is configured and names what is missing", () => {
    const box = new Map([tool("recall_memory"), tool("research_web")].map((t) => [t.name, t]));
    const scout = toolsFor(agent("scout"), box);
    expect(scout.available.map((t) => t.name)).toEqual(["research_web", "recall_memory"]);
    expect(scout.missing).toEqual(["run_python", "mcp:tenki", "mcp:celesto"]);
    const runner = toolsFor(agent("runner"), box);
    expect(runner.available).toEqual([]);
    expect(runner.missing).toContain("add_to_shopping_list");
  });
});
