import { connection } from "next/server";
import { eventsCollection, toWorldEvent, type EventDoc } from "@/lib/events-repo";
import { currentVoices, onVoice } from "@/lib/voice-bus";
import type { ChangeStreamInsertDocument } from "mongodb";

export async function GET(request: Request) {
  await connection();
  const events = await eventsCollection();
  const changes = events.watch<EventDoc, ChangeStreamInsertDocument<EventDoc>>(
    [{ $match: { operationType: "insert" } }],
  );
  const encoder = new TextEncoder();
  let unsubscribe = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          close();
        }
      };
      const heartbeat = setInterval(() => send(": keepalive\n\n"), 15000);
      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        changes.close().catch(() => {});
        try {
          controller.close();
        } catch {}
      };

      changes.on("change", (change) => {
        const doc = { ...change.fullDocument, _id: change.documentKey._id };
        send(`data: ${JSON.stringify(toWorldEvent(doc))}\n\n`);
      });
      changes.on("error", close);
      request.signal.addEventListener("abort", close);

      send(": connected\n\n");
      for (const snapshot of currentVoices()) {
        send(`event: voice\ndata: ${JSON.stringify(snapshot)}\n\n`);
      }
      unsubscribe = onVoice((snapshot) => {
        send(`event: voice\ndata: ${JSON.stringify(snapshot)}\n\n`);
      });
    },
    cancel() {
      unsubscribe();
      changes.close().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
