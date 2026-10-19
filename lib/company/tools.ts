import type { AgentProfile } from "@/lib/company/roster";
import { tools as kylonTools } from "@/lib/sponsors/kylon";
import { mcpTools } from "@/lib/sponsors/mcp";
import { tools as n8nTools } from "@/lib/sponsors/n8n";
import { tools as researchTools } from "@/lib/sponsors/research";
import { tools as rocketrideTools } from "@/lib/sponsors/rocketride";
import { builtinTools, type AgentTool } from "@/lib/tools";

// Every tool the company could have, by name, from whichever sponsor modules
// are configured. An agent's profile lists tool names; what it actually gets
// is the intersection with this box, and it is told which ones are missing.
// A profile entry "mcp:<server>" means every tool that MCP server offers,
// and "mcp:*" every tool from every configured server.

export type ToolContext = { worldState: string; trends: unknown };

export async function toolbox(context: ToolContext): Promise<Map<string, AgentTool>> {
  const all = [
    ...builtinTools(),
    ...researchTools(context),
    ...n8nTools(),
    ...kylonTools(),
    ...rocketrideTools(),
    ...(await mcpTools()),
  ];
  return new Map(all.map((tool) => [tool.name, tool]));
}

/** Expands one profile entry to tool names in the box; empty when nothing matches. Pure. */
export function expand(entry: string, names: Iterable<string>): string[] {
  if (!entry.startsWith("mcp:")) return [entry];
  const server = entry.slice(4);
  const prefix = server === "*" ? "mcp_" : `mcp_${server.toLowerCase().replace(/[^a-z0-9_-]/g, "")}_`;
  return [...names].filter((name) => name.startsWith(prefix));
}

export function toolsFor(profile: AgentProfile, box: Map<string, AgentTool>) {
  const available: AgentTool[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const entry of profile.tools) {
    const names = expand(entry, box.keys()).filter((name) => box.has(name) && !seen.has(name));
    if (names.length === 0) {
      missing.push(entry);
      continue;
    }
    for (const name of names) {
      seen.add(name);
      available.push(box.get(name)!);
    }
  }
  return { available, missing };
}
