import { ROSTER, type AgentKey } from "@/lib/company/roster";
import { errorText, log } from "@/lib/log";
import { envMap, HttpError, requestJson } from "@/lib/sponsors/http";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";

// Masky gives each agent a face and a voice. Every agent has one Masky
// avatar (matched by name, or pinned with MASKY_AVATARS) and one conversation
// per process; speaking a line injects a turn into that conversation and
// waits for the rendered audio. The conversation's liveUrl is an embeddable
// viewer that auto-plays each new turn, so the dashboard can show the faces.
// Optional: without MASKY_API_KEY the phone falls back to ElevenLabs.

const BASE = "https://masky.ai/api";
const AVATAR_TTL_MS = 60_000;
const POLL_MS = 1500;
const SPEAK_TIMEOUT_MS = 25_000;
const MAX_TEXT = 600;

export type Avatar = { avatarId: string; ownerId: string; displayName: string; imageUrl?: string };

type ApiAvatar = { avatarId: string; avatarOwnerUserId: string; displayName?: string };
type Conversation = { conversationId: string; shareSlug: string; liveUrl: string };
export type Turn = { id: string; role?: string; status?: string; audioUrl?: string | null; videoUrl?: string | null };

const key = () => process.env.MASKY_API_KEY;
const headers = () => ({ Authorization: `Bearer ${key()}` });

let avatarCache: { at: number; list: ApiAvatar[] } | null = null;
const imageCache = new Map<string, string | undefined>();
const conversations = new Map<AgentKey, Conversation>();

/** The avatar for an agent: MASKY_AVATARS wins, else the avatar named like the agent. */
export function matchAvatar(agentKey: AgentKey, list: ApiAvatar[], pinned: Record<string, string>): Avatar | null {
  const profile = ROSTER.find((agent) => agent.key === agentKey);
  const wanted = [agentKey, profile?.name ?? ""].map((name) => name.toLowerCase());
  const found = pinned[agentKey]
    ? list.find((avatar) => avatar.avatarId === pinned[agentKey])
    : list.find((avatar) => wanted.includes((avatar.displayName ?? "").trim().toLowerCase()));
  if (!found) return null;
  return { avatarId: found.avatarId, ownerId: found.avatarOwnerUserId, displayName: found.displayName ?? agentKey };
}

/** The newest turn spoken by the avatar that has the asked-for media. */
export function readyTurn(turns: Turn[], output: "audio" | "video"): Turn | null {
  const field = output === "video" ? "videoUrl" : "audioUrl";
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (turn.role === "user") continue;
    if (turn[field]) return turn;
  }
  return null;
}

export async function avatars(): Promise<ApiAvatar[]> {
  if (!key()) return [];
  if (avatarCache && Date.now() - avatarCache.at < AVATAR_TTL_MS) return avatarCache.list;
  const body = await requestJson<{ avatars?: ApiAvatar[] }>(`${BASE}/avatars`, { headers: headers() });
  avatarCache = { at: Date.now(), list: body.avatars ?? [] };
  return avatarCache.list;
}

async function imageFor(avatarId: string) {
  if (imageCache.has(avatarId)) return imageCache.get(avatarId);
  let url: string | undefined;
  try {
    const body = await requestJson<{ primary?: string }>(`${BASE}/avatars/${avatarId}/images`, { headers: headers() });
    url = body.primary || undefined;
  } catch (cause) {
    log("masky", "avatar image failed", { avatarId, error: errorText(cause) });
  }
  imageCache.set(avatarId, url);
  return url;
}

export async function avatarFor(agentKey: AgentKey): Promise<Avatar | null> {
  if (!key()) return null;
  const avatar = matchAvatar(agentKey, await avatars(), envMap("MASKY_AVATARS"));
  if (!avatar) return null;
  return { ...avatar, imageUrl: await imageFor(avatar.avatarId) };
}

async function conversationFor(agentKey: AgentKey, avatar: Avatar, fresh = false) {
  const cached = conversations.get(agentKey);
  if (cached && !fresh) return cached;
  const body = await requestJson<Conversation>(`${BASE}/conversations`, {
    method: "POST",
    headers: headers(),
    body: { avatarId: avatar.avatarId, avatarOwnerUserId: avatar.ownerId },
  });
  conversations.set(agentKey, body);
  log("masky", "conversation started", { agent: agentKey, conversationId: body.conversationId, liveUrl: body.liveUrl });
  return body;
}

/** Says `text` in the agent's voice and waits for the rendered media. */
export async function speak(
  agentKey: AgentKey,
  text: string,
  { output = "audio", timeoutMs = SPEAK_TIMEOUT_MS }: { output?: "audio" | "video"; timeoutMs?: number } = {},
) {
  if (!key()) throw new Error("MASKY_API_KEY is not set");
  const avatar = await avatarFor(agentKey);
  if (!avatar) throw new Error(`masky: no avatar for ${agentKey}`);
  const line = text.trim().slice(0, MAX_TEXT);
  const started = performance.now();

  let conversation = await conversationFor(agentKey, avatar);
  const inject = (target: Conversation) =>
    requestJson<unknown>(`${BASE}/conversations/${target.conversationId}/turn`, {
      method: "POST",
      headers: headers(),
      body: { userText: line, mode: "speak", output },
      timeoutMs: 20_000,
    });
  try {
    await inject(conversation);
  } catch (cause) {
    // A conversation from an earlier run may be gone: start a new one once.
    if (!(cause instanceof HttpError && cause.status === 404)) throw cause;
    conversation = await conversationFor(agentKey, avatar, true);
    await inject(conversation);
  }

  const deadline = started + timeoutMs;
  while (performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const body = await requestJson<{ turns?: Turn[] }>(`${BASE}/conversations/by-slug/${conversation.shareSlug}`, {
      headers: headers(),
    });
    const turn = readyTurn(body.turns ?? [], output);
    if (turn) {
      log("masky", "spoke", { agent: agentKey, output, ms: Math.round(performance.now() - started) });
      return {
        audioUrl: turn.audioUrl ?? undefined,
        videoUrl: turn.videoUrl ?? undefined,
        liveUrl: conversation.liveUrl,
        conversationId: conversation.conversationId,
      };
    }
  }
  throw new Error("masky: turn not ready in time");
}

export const liveUrl = (agentKey: AgentKey) => conversations.get(agentKey)?.liveUrl ?? null;

/** Faces for the dashboard; empty when Masky is not set up or unreachable. */
export async function avatarCards() {
  if (!key()) return [];
  try {
    const list = await avatars();
    const pinned = envMap("MASKY_AVATARS");
    const cards = await Promise.all(
      ROSTER.map(async (profile) => {
        const avatar = matchAvatar(profile.key, list, pinned);
        if (!avatar) return null;
        return {
          key: profile.key,
          name: profile.name,
          avatarId: avatar.avatarId,
          imageUrl: await imageFor(avatar.avatarId),
          liveUrl: liveUrl(profile.key),
        };
      }),
    );
    return cards.filter((card): card is NonNullable<typeof card> => card !== null);
  } catch (cause) {
    log("masky", "avatar cards failed", { error: errorText(cause) });
    return [];
  }
}

export const sponsor: Sponsor = {
  key: "masky",
  name: "Masky.AI",
  role: "A face and a voice for every agent; the Front Desk speaks through it.",
  env: ["MASKY_API_KEY", "MASKY_AVATARS"],
  configured: () => Boolean(key()),
  status: async (deep = false) => {
    if (!key()) return notConfigured("MASKY_API_KEY not set");
    return checked(async () => {
      const list = await avatars();
      const pinned = envMap("MASKY_AVATARS");
      const matched = ROSTER.filter((profile) => matchAvatar(profile.key, list, pinned)).map((profile) => profile.key);
      let detail = `${list.length} avatars; matched: ${matched.length ? matched.join(", ") : "none"}`;
      if (deep) {
        const began = performance.now();
        const spoken = await speak("host", "Systems check from OPENSTATE.");
        detail += `; spoke as host in ${Math.round(performance.now() - began)} ms (${spoken.audioUrl ? "audio ready" : "no audio"})`;
      }
      return { detail };
    });
  },
};
