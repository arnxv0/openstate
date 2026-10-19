import { ROSTER, type AgentKey } from "@/lib/company/roster";
import { errorText, log } from "@/lib/log";
import { avatarFor, speak, sponsor as masky } from "@/lib/sponsors/masky";

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
const MODEL_ID = process.env.ELEVENLABS_TTS_MODEL ?? "eleven_flash_v2_5";

const isAgentKey = (value: unknown): value is AgentKey =>
  typeof value === "string" && ROSTER.some((profile) => profile.key === value);

/** The line in the agent's Masky voice, or null when Masky cannot provide it. */
async function maskyAudio(agent: AgentKey, text: string) {
  if (!masky.configured() || !(await avatarFor(agent))) return null;
  try {
    const spoken = await speak(agent, text, { output: "audio" });
    if (!spoken.audioUrl) return null;
    const upstream = await fetch(spoken.audioUrl, { signal: AbortSignal.timeout(15_000) });
    if (!upstream.ok || !upstream.body) throw new Error(`audio ${upstream.status}`);
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Voice-Engine": "masky",
        "X-Masky-Live": spoken.liveUrl,
      },
    });
  } catch (cause) {
    log("masky", "tts failed, falling back", { agent, error: errorText(cause) });
    return null;
  }
}

export async function POST(request: Request) {
  const { text, agent } = (await request.json().catch(() => ({}))) as { text?: string; agent?: string };
  if (!text?.trim()) return Response.json({ error: "text required" }, { status: 400 });

  const engine = new URL(request.url).searchParams.get("engine");
  if (engine !== "elevenlabs") {
    const spoken = await maskyAudio(isAgentKey(agent) ? agent : "host", text);
    if (spoken) return spoken;
  }

  // Fallbacks, in order: ElevenLabs, then OpenAI's TTS, so the phone still
  // talks when Masky has no credits or ElevenLabs is rate limited.
  const errors: string[] = [];
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (elevenKey && engine !== "openai") {
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?output_format=mp3_44100_128`,
        {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.slice(0, 600), model_id: MODEL_ID }),
        },
      );
      if (!response.ok || !response.body) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return new Response(response.body, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Engine": "elevenlabs" },
      });
    } catch (cause) {
      errors.push(errorText(cause));
      log("voice", "elevenlabs failed, falling back", { error: errorText(cause) });
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
          voice: process.env.OPENAI_TTS_VOICE ?? "coral",
          input: text.slice(0, 600),
          response_format: "mp3",
        }),
      });
      if (!response.ok || !response.body) throw new Error(`OpenAI TTS ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return new Response(response.body, {
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Engine": "openai" },
      });
    } catch (cause) {
      errors.push(errorText(cause));
      log("voice", "openai tts failed", { error: errorText(cause) });
    }
  }

  if (!elevenKey && !openaiKey) {
    return Response.json({ error: "No voice available: set MASKY_API_KEY (with an avatar), ELEVENLABS_API_KEY or OPENAI_API_KEY" }, { status: 503 });
  }
  return Response.json({ error: errors.join(" | ") }, { status: 502 });
}
