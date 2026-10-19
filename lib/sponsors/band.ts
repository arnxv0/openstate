import { ROSTER, type AgentKey } from "@/lib/company/roster";
import { errorText, log } from "@/lib/log";
import { requestJson } from "@/lib/sponsors/http";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";

// BAND: the room where the company talks. Each agent in the roster is a
// remote agent registered in BAND (one UUID + API key each), and the human
// makes one chat room with all of them in it. Every line of the company's
// transcript is posted from the agent that said it, @mentioning the agent it
// is for, so people can watch the delegation happen in BAND. Send-only: we
// never wait for replies, so no WebSocket. Every call is best-effort.
//
// BAND_AGENTS="gm=<uuid>:<key>,host=<uuid>:<key>,…"   BAND_ROOM_ID=<room uuid>

const BASE = process.env.BAND_BASE_URL ?? "https://app.band.ai/api/v1/agent";
const TIMEOUT_MS = 8000;
const PARTICIPANTS_TTL_MS = 60_000;

export type BandAgent = { key: AgentKey; agentId: string; apiKey: string };

export type Participant = {
  id: string;
  name: string;
  handle: string;
  /** "agent" or "user" as BAND reports it; anything else is kept as given. */
  type: string;
};

export type EventType = "thought" | "tool_call" | "tool_result" | "error" | "task";

const KEYS = new Set<string>(ROSTER.map((profile) => profile.key));

/** "gm=uuid:key,host=uuid:key" → agents; malformed entries are dropped. */
export function parseAgents(value: string | undefined): BandAgent[] {
  const agents: BandAgent[] = [];
  for (const entry of (value ?? "").split(",")) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const key = entry.slice(0, eq).trim().toLowerCase();
    const rest = entry.slice(eq + 1).trim();
    const colon = rest.indexOf(":");
    if (!KEYS.has(key) || colon === -1) continue;
    const agentId = rest.slice(0, colon).trim();
    const apiKey = rest.slice(colon + 1).trim();
    if (agentId && apiKey) agents.push({ key: key as AgentKey, agentId, apiKey });
  }
  return agents;
}

const agents = () => parseAgents(process.env.BAND_AGENTS);
const roomId = () => process.env.BAND_ROOM_ID?.trim() || null;
const agentFor = (key: AgentKey) => agents().find((agent) => agent.key === key) ?? null;

const configured = () => agents().length > 0 && roomId() !== null;

const norm = (text: string) => text.trim().toLowerCase().replace(/^@/, "");

/**
 * The participant that stands for a roster agent: BAND's name or handle
 * equals the agent's display name ("Mira") or roster key ("gm"), ignoring
 * case. Returns null when the room has no such participant.
 */
export function matchParticipant(participants: Participant[], key: AgentKey): Participant | null {
  const profile = ROSTER.find((candidate) => candidate.key === key);
  const wanted = new Set([norm(key), ...(profile ? [norm(profile.name)] : [])]);
  return (
    participants.find((participant) => wanted.has(norm(participant.name)) || wanted.has(norm(participant.handle))) ??
    null
  );
}

/** The first human in the room, for lines addressed to the household. */
export function humanParticipant(participants: Participant[]): Participant | null {
  return participants.find((participant) => participant.type.toLowerCase() === "user") ?? null;
}

/** "@Name @Other text" with the mentions BAND requires alongside it. */
export function buildMessage(text: string, mentions: Participant[]) {
  const prefix = mentions.map((participant) => `@${participant.name}`).join(" ");
  return {
    message: {
      content: prefix ? `${prefix} ${text}` : text,
      mentions: mentions.map(({ id, name, handle }) => ({ id, name, handle })),
    },
  };
}

/** Participants as BAND returns them, in whichever of the usual envelopes it uses. */
export function normaliseParticipants(body: unknown): Participant[] {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as { participants?: unknown; data?: unknown }).participants ??
        (body as { data?: unknown }).data ??
        [])
      : [];
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      // Some responses nest the identity under `user` / `agent`.
      const inner = (item.user ?? item.agent ?? item) as Record<string, unknown>;
      const id = String(item.participant_id ?? item.id ?? inner.id ?? "");
      const name = String(inner.name ?? inner.display_name ?? item.name ?? "");
      const handle = String(inner.handle ?? inner.slug ?? item.handle ?? name);
      const type = String(item.type ?? item.participant_type ?? inner.type ?? (item.agent ? "agent" : item.user ? "user" : ""));
      return { id, name, handle, type };
    })
    .filter((participant) => participant.id && participant.name);
}

const headers = (apiKey: string) => ({ "X-API-Key": apiKey });

let participantsCache: { at: number; list: Participant[] } | null = null;

async function participants(apiKey: string): Promise<Participant[]> {
  if (participantsCache && Date.now() - participantsCache.at < PARTICIPANTS_TTL_MS) return participantsCache.list;
  const body = await requestJson<unknown>(`${BASE}/chats/${roomId()}/participants`, {
    headers: headers(apiKey),
    timeoutMs: TIMEOUT_MS,
  });
  const list = normaliseParticipants(body);
  participantsCache = { at: Date.now(), list };
  return list;
}

type Me = { id?: string; name?: string; handle?: string; agent?: { id?: string; name?: string; handle?: string } };

export const sponsor: Sponsor = {
  key: "band",
  name: "BAND",
  role: "The chat room where the agents delegate to each other, visible to the household",
  env: ["BAND_AGENTS", "BAND_ROOM_ID"],
  configured,
  status: async () => {
    if (!configured()) return notConfigured("set BAND_AGENTS (key=uuid:apiKey,…) and BAND_ROOM_ID");
    return checked(async () => {
      const identities = await Promise.all(
        agents().map(async (agent) => {
          try {
            const me = await requestJson<Me>(`${BASE}/me`, { headers: headers(agent.apiKey), timeoutMs: TIMEOUT_MS });
            const who = me.agent ?? me;
            return `${agent.key}=${who.handle ?? who.name ?? who.id ?? "ok"}`;
          } catch (cause) {
            return `${agent.key}=FAILED (${errorText(cause).slice(0, 80)})`;
          }
        }),
      );
      const failed = identities.filter((line) => line.includes("FAILED")).length;
      let room = "room unreachable";
      try {
        const list = await participants(agents()[0].apiKey);
        room = `room ${roomId()}: ${list.length} participants`;
      } catch (cause) {
        room = `room ${roomId()}: ${errorText(cause).slice(0, 80)}`;
      }
      return {
        ok: failed === 0 && !room.includes("unreachable"),
        detail: `${identities.join(", ")}; ${room}`,
        ...(failed ? { error: `${failed} agent key(s) failed` } : {}),
      };
    });
  },
};

/** Posts one transcript line to the room, from `from`, for `to`. Never throws. */
export async function post({
  from,
  to,
  text,
  tools,
}: {
  from: AgentKey;
  to: AgentKey | "all" | "user";
  text: string;
  tools?: string[];
}): Promise<{ ok: boolean; via: "message" | "event"; error?: string }> {
  const sender = agentFor(from);
  const room = roomId();
  if (!sender || !room) return { ok: false, via: "event", error: "not configured" };
  try {
    const list = await participants(sender.apiKey);
    const self = matchParticipant(list, from);
    let mentions: Participant[] = [];
    if (to === "all") {
      mentions = agents()
        .filter((agent) => agent.key !== from)
        .map((agent) => matchParticipant(list, agent.key))
        .filter((participant): participant is Participant => participant !== null);
    } else if (to === "user") {
      const human = humanParticipant(list);
      if (human) mentions = [human];
    } else {
      const target = matchParticipant(list, to);
      if (target) mentions = [target];
    }
    mentions = mentions.filter((participant) => participant.id !== self?.id);
    const suffix = tools?.length ? ` (tools: ${tools.join(", ")})` : "";
    if (mentions.length === 0) {
      await requestJson(`${BASE}/chats/${room}/events`, {
        method: "POST",
        headers: headers(sender.apiKey),
        body: { event: { content: `${text}${suffix}`, message_type: "thought", metadata: { to, tools: tools ?? [] } } },
        timeoutMs: TIMEOUT_MS,
      });
      log("band", "posted as event", { from, to });
      return { ok: true, via: "event" };
    }
    await requestJson(`${BASE}/chats/${room}/messages`, {
      method: "POST",
      headers: headers(sender.apiKey),
      body: buildMessage(`${text}${suffix}`, mentions),
      timeoutMs: TIMEOUT_MS,
    });
    log("band", "posted", { from, to, mentions: mentions.map((participant) => participant.name) });
    return { ok: true, via: "message" };
  } catch (cause) {
    log("band", "post failed", { from, to, error: errorText(cause) });
    return { ok: false, via: "message", error: errorText(cause) };
  }
}

/** Records what an agent is doing (tool calls, errors) without addressing anyone. Never throws. */
export async function event({
  from,
  type,
  content,
  metadata,
}: {
  from: AgentKey;
  type: EventType;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
  const sender = agentFor(from);
  const room = roomId();
  if (!sender || !room) return false;
  try {
    await requestJson(`${BASE}/chats/${room}/events`, {
      method: "POST",
      headers: headers(sender.apiKey),
      body: { event: { content, message_type: type, ...(metadata ? { metadata } : {}) } },
      timeoutMs: TIMEOUT_MS,
    });
    return true;
  } catch (cause) {
    log("band", "event failed", { from, type, error: errorText(cause) });
    return false;
  }
}

/** Who is in the room, for the dashboard. Never throws. */
export async function participantsSummary(): Promise<{
  configured: boolean;
  roomId: string | null;
  participants: Participant[];
  agents: AgentKey[];
  error?: string;
}> {
  const list = agents();
  const room = roomId();
  if (!configured()) return { configured: false, roomId: room, participants: [], agents: list.map((agent) => agent.key) };
  try {
    return { configured: true, roomId: room, participants: await participants(list[0].apiKey), agents: list.map((agent) => agent.key) };
  } catch (cause) {
    return { configured: true, roomId: room, participants: [], agents: list.map((agent) => agent.key), error: errorText(cause) };
  }
}
