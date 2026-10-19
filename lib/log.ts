import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// One debugging trail for the whole system: server steps and the events the
// dashboard and phones report through /api/log all land in logs/openstate.log
// as one JSON object per line, oldest first. Read it with
//   tail -f logs/openstate.log
// or filter by scope:  grep '"scope":"episode"' logs/openstate.log

const DIR = path.join(process.cwd(), "logs");
const FILE = path.join(DIR, "openstate.log");

export type LogEntry = {
  t: string;
  src: "server" | "dashboard" | "phone";
  scope: string;
  msg: string;
  data?: Record<string, unknown>;
};

let ready: Promise<unknown> | undefined;
let queue: Promise<unknown> = Promise.resolve();

export function writeEntries(entries: LogEntry[]) {
  // Unit tests exercise logged code paths; keep them out of the real trail.
  if (entries.length === 0 || (process.env.VITEST && !process.env.LOG_IN_TESTS)) return;
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  ready ??= mkdir(DIR, { recursive: true });
  // Appends are chained so lines from concurrent requests never interleave.
  queue = queue
    .then(() => ready)
    .then(() => appendFile(FILE, lines))
    .catch((cause) => console.warn(`[log] write failed: ${cause instanceof Error ? cause.message : cause}`));
}

/** Server-side log line. Never throws and never blocks the request. */
export function log(scope: string, msg: string, data?: Record<string, unknown>) {
  writeEntries([{ t: new Date().toISOString(), src: "server", scope, msg, data }]);
}

export const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
