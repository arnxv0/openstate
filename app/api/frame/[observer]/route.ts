import { MAX_FRAME_BYTES, nextFrame, putFrame } from "@/lib/frame-relay";
import { isObserverId } from "@/lib/signal-store";

// Relayed video for when WebRTC cannot connect. The phone POSTs one JPEG per
// request; the dashboard long-polls GET ?after=<seq> for the next one.

export async function POST(request: Request, ctx: RouteContext<"/api/frame/[observer]">) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) return Response.json({ error: "unknown observer" }, { status: 404 });
  const jpeg = new Uint8Array(await request.arrayBuffer());
  if (jpeg.length < 100 || jpeg.length > MAX_FRAME_BYTES) {
    return Response.json({ error: "bad frame" }, { status: 400 });
  }
  const capturedAt = Number(request.headers.get("X-Frame-At")) || undefined;
  return Response.json({ seq: putFrame(observer, jpeg, Date.now(), capturedAt) });
}

export async function GET(request: Request, ctx: RouteContext<"/api/frame/[observer]">) {
  const { observer } = await ctx.params;
  if (!isObserverId(observer)) return Response.json({ error: "unknown observer" }, { status: 404 });
  const after = Number(new URL(request.url).searchParams.get("after")) || 0;
  const frame = await nextFrame(observer, after, 2000);
  if (!frame) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return new Response(frame.jpeg, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
      "X-Frame-Seq": String(frame.seq),
    },
  });
}
