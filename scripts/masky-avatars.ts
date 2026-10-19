// Creates a Masky avatar for every agent in the roster that does not have
// one yet: a generated portrait, a preset voice and the agent's persona.
// Idempotent: agents whose display name already exists are skipped.
//
//   npm run masky:avatars            # create what is missing
//   npm run masky:avatars -- --list  # only show what exists
//
// Costs Masky credits for each generated image (about 0.005 each).
import { ROSTER, type AgentKey } from "@/lib/company/roster";

const key = process.env.MASKY_API_KEY;
if (!key) {
  console.error("MASKY_API_KEY is not set");
  process.exit(1);
}
const BASE = "https://masky.ai/api";
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const listOnly = process.argv.includes("--list");

// Preset voices from GET /api/voices, chosen to fit each character.
const VOICE: Record<AgentKey, string> = {
  gm: "Claire",
  eyes: "Anna",
  ledger: "Benjamin",
  scout: "Cool Journalist",
  runner: "Arjun",
  host: "Cheerful Canadian",
};

const LOOK: Record<AgentKey, string> = {
  gm: "a composed woman in her forties, short silver-streaked hair, dark blazer, slight smile",
  eyes: "a young woman with sharp eyes and round glasses, hair tied back, teal shirt",
  ledger: "a thoughtful older man with a grey beard, cardigan, warm lamp light",
  scout: "a curious woman in her thirties, curly hair, denim jacket, notebook in hand",
  runner: "a brisk man in his thirties, rolled sleeves, headset around the neck, friendly",
  host: "a warm person in their twenties, bright smile, soft yellow sweater",
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { ...init, headers, signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

const [{ avatars }, { voices }] = await Promise.all([
  api<{ avatars: { avatarId: string; displayName: string; avatarOwnerUserId: string }[] }>("/avatars"),
  api<{ voices: { id: string; name: string }[] }>("/voices"),
]);
const existing = new Map(avatars.map((avatar) => [avatar.displayName.trim().toLowerCase(), avatar]));
console.log(`${avatars.length} avatars on the account: ${avatars.map((a) => a.displayName).join(", ") || "none"}`);
if (listOnly) process.exit(0);

// The Front Desk's voice is the one the phone plays, so on a plan that allows
// a single avatar it is the one that gets created.
const ordered = [...ROSTER].sort((a, b) => (a.key === "host" ? -1 : b.key === "host" ? 1 : 0));
for (const agent of ordered) {
  const found = existing.get(agent.name.toLowerCase());
  if (found) {
    console.log(`· ${agent.name} (${agent.title}) exists: ${found.avatarId}`);
    continue;
  }
  const voice = voices.find((candidate) => candidate.name.toLowerCase() === VOICE[agent.key].toLowerCase()) ?? voices[0];
  const prompt = `Portrait photo of ${LOOK[agent.key]}, ${agent.title} at a small company, looking at the camera, neutral studio background, soft light, head and shoulders, photorealistic`;
  // A generated portrait when the account has credits; otherwise a free,
  // deterministic illustrated one, so the roster still gets faces.
  let imageUrl = `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(agent.name)}&size=512&backgroundColor=${agent.color.slice(1)}`;
  let source = "dicebear";
  try {
    imageUrl = (await api<{ imageUrl: string }>("/images/generate", { method: "POST", body: JSON.stringify({ prompt, aspectRatio: "1:1" }) })).imageUrl;
    source = "generated";
  } catch (cause) {
    if (!/ 402:/.test(String(cause))) throw cause;
    console.log(`  (no Masky credits for an image; using an illustrated portrait for ${agent.name})`);
  }
  const created = await api<{ avatar?: { avatarId: string }; avatarId?: string }>("/avatars", {
    method: "POST",
    body: JSON.stringify({
      displayName: agent.name,
      imageUrl,
      voiceId: voice.id,
      personalityPrompt: `You are ${agent.name}, ${agent.title} at OPENSTATE, an agent-run household supply operation. ${agent.persona}`,
      publiclyRenderable: true,
    }),
  });
  console.log(`✓ ${agent.name} (${agent.title}) created: ${created.avatar?.avatarId ?? created.avatarId} · voice ${voice.name} · ${source} portrait`);
}
