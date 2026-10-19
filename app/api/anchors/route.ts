import { connection } from "next/server";
import { EMBEDDING_DIMS, listAnchors, saveAnchor } from "@/lib/anchors";
import { holdsLease } from "@/lib/capture-lease";
import { isObserverId } from "@/lib/signal-store";

const MAX_REFERENCES_PER_CALL = 12;

export async function GET() {
  await connection();
  return Response.json({ anchors: await listAnchors() });
}

type Body = {
  name?: string;
  observerId?: string;
  viewer?: string;
  references?: { embedding?: unknown; hash?: unknown }[];
};

function validReference(ref: { embedding?: unknown; hash?: unknown }) {
  return (
    Array.isArray(ref.embedding) &&
    ref.embedding.length > 0 &&
    ref.embedding.length <= EMBEDDING_DIMS * 2 &&
    ref.embedding.every((v) => typeof v === "number" && Number.isFinite(v)) &&
    typeof ref.hash === "string" &&
    /^[0-9a-f]{16}$/.test(ref.hash)
  );
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const name = body.name?.trim().slice(0, 40);
  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  if (!body.observerId || !isObserverId(body.observerId)) {
    return Response.json({ error: "unknown observer" }, { status: 404 });
  }
  if (body.viewer && !holdsLease(body.viewer)) {
    return Response.json({ error: "not the capture leader" }, { status: 409 });
  }
  const references = (body.references ?? [])
    .filter(validReference)
    .slice(0, MAX_REFERENCES_PER_CALL) as { embedding: number[]; hash: string }[];
  if (references.length === 0) {
    return Response.json({ error: "at least one reference required" }, { status: 400 });
  }

  return Response.json(await saveAnchor({ name, observerId: body.observerId, references }));
}
