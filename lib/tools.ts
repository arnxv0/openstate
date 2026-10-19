import { eventsCollection } from "@/lib/events-repo";
import { cameraLabel } from "@/lib/observers";
import { searchMemories } from "@/lib/long-term-memory";
import { retrieveMemories } from "@/lib/memory";

// Built-in tools every agent in the company can call. The world state, trends
// and the memories that match the question are already in the prompt, so
// these cover what the prompt cannot carry: a second look at memory with a
// different query and more of the change history. Sponsor tools (sandbox
// research, n8n workflows, Kylon actions) live in lib/sponsors/.

import type { JsonSchema } from "@/lib/agent-types";

export type { JsonSchema };

export type AgentTool = {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Runs the tool and returns what the model should read; errors become text too. */
  run: (args: Record<string, unknown>) => Promise<string>;
};

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const recallMemoryTool: AgentTool = {
  name: "recall_memory",
  description:
    "Search long-term memory (facts people asked to remember, past sightings, the household's places) and the event log with a new query. Use when the memories already in the prompt do not cover what is asked.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "What to look for, in plain words." } },
    required: ["query"],
    additionalProperties: false,
  },
  run: async (args) => {
    const query = str(args.query);
    if (!query) return "No query given.";
    const [longTerm, { memories }] = await Promise.all([searchMemories(query), retrieveMemories(query, 6)]);
    const events = memories.map((m) => `- [${m.when}, ${cameraLabel(m.observerId)}] ${m.text}`).join("\n");
    return [longTerm || "No long-term memories match.", events ? `Events:\n${events}` : "No events match."].join("\n\n");
  },
};

export const recentEventsTool: AgentTool = {
  name: "get_recent_events",
  description:
    "The most recent recorded changes and sightings (what was taken, added, registered, by whose camera and when), newest first. Filter by place or item name.",
  parameters: {
    type: "object",
    properties: {
      place_or_item: { type: "string", description: "Only events mentioning this place or item; omit for all." },
      limit: { type: "number", description: "How many, up to 30. Default 12." },
    },
    additionalProperties: false,
  },
  run: async (args) => {
    const filter = str(args.place_or_item).trim();
    const limit = Math.min(30, Math.max(1, Math.round(num(args.limit, 12))));
    const docs = await (await eventsCollection())
      .find({
        type: { $in: ["transition", "observation", "state", "memory"] },
        ...(filter ? { summary: { $regex: filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {}),
      })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    if (docs.length === 0) return filter ? `No events mention "${filter}".` : "No events recorded.";
    return docs
      .map((doc) => `- ${doc.ts.toLocaleString("en-GB")} · ${cameraLabel(doc.observerId)} · ${doc.summary}`)
      .join("\n");
  },
};

/** The built-in tools every agent gets. */
export function builtinTools(): AgentTool[] {
  return [recallMemoryTool, recentEventsTool];
}
