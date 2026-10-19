export async function POST() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return Response.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 503 });
  }

  const response = await fetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    { method: "POST", headers: { "xi-api-key": key } },
  );
  if (!response.ok) {
    return Response.json(
      { error: `ElevenLabs ${response.status}: ${await response.text()}` },
      { status: 502 },
    );
  }

  const { token } = (await response.json()) as { token: string };
  return Response.json({ token });
}
