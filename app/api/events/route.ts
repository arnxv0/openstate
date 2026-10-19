import { connection } from "next/server";
import { recentEvents } from "@/lib/events-repo";
import { currentVoices } from "@/lib/voice-bus";

// Recent events plus the live voice state of each phone. The dashboard reads
// this once on load and then keeps polling it, because the event stream
// (/api/stream) does not get through every tunnel.
export async function GET() {
  await connection();
  return Response.json({ events: await recentEvents(), voices: currentVoices() });
}
