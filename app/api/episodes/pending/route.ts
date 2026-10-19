import { holdsLease } from "@/lib/capture-lease";
import { expectEpisode } from "@/lib/episode-queue";
import { isObserverId } from "@/lib/signal-store";

// The capturing dashboard calls this the moment it sees movement at a site,
// so a question asked in the next few seconds waits for the episode that is
// about to arrive instead of answering from the state before the change.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { observerId?: string; viewer?: string };
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  if (body.viewer && !holdsLease(body.viewer)) return new Response(null, { status: 204 });
  expectEpisode(body.observerId);
  return new Response(null, { status: 204 });
}
