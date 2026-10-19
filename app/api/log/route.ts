import { writeEntries, type LogEntry } from "@/lib/log";

// Receives batches of client events (dashboard and phones) for the shared
// debugging log. See lib/log.ts and lib/client-log.ts.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { entries?: Partial<LogEntry>[] };
  const entries = (body.entries ?? [])
    .slice(0, 100)
    .filter((entry) => typeof entry.scope === "string" && typeof entry.msg === "string")
    .map(
      (entry): LogEntry => ({
        t: typeof entry.t === "string" ? entry.t : new Date().toISOString(),
        src: entry.src === "phone" ? "phone" : "dashboard",
        scope: String(entry.scope).slice(0, 40),
        msg: String(entry.msg).slice(0, 300),
        data: entry.data && typeof entry.data === "object" ? entry.data : undefined,
      }),
    );
  writeEntries(entries);
  return new Response(null, { status: 204 });
}
