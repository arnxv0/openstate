import { claimLease } from "@/lib/capture-lease";

export async function POST(request: Request) {
  const { viewer } = (await request.json().catch(() => ({}))) as { viewer?: string };
  if (!viewer) return Response.json({ error: "viewer required" }, { status: 400 });
  return Response.json({ leader: claimLease(viewer) });
}
