import { insertEvent } from "@/lib/events-repo";
import { errorText, log } from "@/lib/log";
import { agent, type AgentKey } from "@/lib/company/roster";

// What the agents said to each other, in order. Kept in memory for the
// dashboard (GET /api/company), written to the events collection so it is
// part of the household record, and mirrored into the BAND chat room so the
// humans there see the company work. Every sink is best-effort.

export type Line = {
  id: string;
  at: string;
  from: AgentKey;
  to: AgentKey | "user" | "all";
  text: string;
  /** Tools the speaker used before saying this. */
  tools?: string[];
  ms?: number;
  /** Groups the lines of one request. */
  requestId: string;
};

const LIMIT = 200;
const ring: Line[] = [];
let counter = 0;

export const newRequestId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const nameOf = (key: AgentKey | "user" | "all") =>
  key === "user" ? "the household" : key === "all" ? "everyone" : agent(key).name;

type BandPost = (line: { from: AgentKey; to: AgentKey | "user" | "all"; text: string; tools?: string[] }) => Promise<unknown>;
let bandPost: BandPost | null = null;

/** lib/sponsors/band.ts registers itself here so this file has no hard dependency on it. */
export function mirrorTo(post: BandPost | null) {
  bandPost = post;
}

export function record(line: Omit<Line, "id" | "at">): Line {
  const full: Line = { ...line, id: `${line.requestId}-${ring.length}`, at: new Date().toISOString() };
  ring.push(full);
  if (ring.length > LIMIT) ring.splice(0, ring.length - LIMIT);
  log("company", "line", { from: full.from, to: full.to, text: full.text.slice(0, 200), tools: full.tools, ms: full.ms });
  void insertEvent({
    type: "agent",
    title: `${agent(full.from).name} → ${nameOf(full.to)}`,
    message: full.text,
    summary: `${agent(full.from).name} (${agent(full.from).title}) to ${nameOf(full.to)}: ${full.text}`,
    metadata: { from: full.from, to: full.to, ...(full.tools?.length ? { detail: full.tools.join(", ") } : {}) },
  }).catch((cause) => log("company", "event write failed", { error: errorText(cause) }));
  if (bandPost) {
    void bandPost({ from: full.from, to: full.to, text: full.text, tools: full.tools }).catch((cause) =>
      log("company", "band mirror failed", { error: errorText(cause) }),
    );
  }
  return full;
}

export function recent(limit = 40, requestId?: string) {
  const lines = requestId ? ring.filter((line) => line.requestId === requestId) : ring;
  return lines.slice(-limit);
}
