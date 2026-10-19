import { COLLECTIONS } from "@/lib/db-schema";
import { db } from "@/lib/mongo";

// One stored episode frame as a JPEG. Frames are addressed by content hash,
// so the browser can cache them for good and the places page stays light.
export async function GET(_request: Request, ctx: RouteContext<"/api/frames/[hash]">) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response(null, { status: 400 });
  const frame = await (await db())
    .collection(COLLECTIONS.frames)
    .findOne({ hash }, { projection: { image: 1 } });
  if (!frame?.image) return new Response(null, { status: 404 });
  const base64 = String(frame.image).replace(/^data:image\/\w+;base64,/, "");
  return new Response(Buffer.from(base64, "base64"), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400, immutable" },
  });
}
