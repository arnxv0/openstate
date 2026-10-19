// Checks every sponsor integration on its own, without the dev server:
//
//   npm run check                 # all sponsors, cheap checks
//   npm run check -- masky band   # only those
//   npm run check -- --deep       # checks that spend credits (speak, boot a VM, compress)
//
// Exit code 1 when a configured sponsor fails its check.
import { SPONSORS, sponsorStatuses } from "@/lib/sponsors";

const args = process.argv.slice(2);
const deep = args.includes("--deep");
const keys = args.filter((arg) => !arg.startsWith("--")).map((arg) => arg.toLowerCase());
const unknown = keys.filter((key) => !SPONSORS.some((sponsor) => sponsor.key === key));
if (unknown.length) {
  console.error(`unknown sponsor(s): ${unknown.join(", ")}; known: ${SPONSORS.map((s) => s.key).join(", ")}`);
  process.exit(2);
}

const statuses = await sponsorStatuses(keys, deep);
let failed = 0;
for (const sponsor of SPONSORS) {
  const status = statuses[sponsor.key];
  if (!status) continue;
  const mark = !status.configured ? "·" : status.ok ? "✓" : "✗";
  if (status.configured && !status.ok) failed += 1;
  const latency = status.latencyMs !== undefined ? ` (${status.latencyMs} ms)` : "";
  console.log(`${mark} ${sponsor.name.padEnd(11)} ${status.detail ?? status.error ?? (status.configured ? "ok" : "not configured")}${latency}`);
  if (status.error && status.detail) console.log(`             ${status.error}`);
  if (!status.configured && sponsor.env.length) console.log(`             env: ${sponsor.env.join(", ")}`);
}
console.log(`\n${Object.values(statuses).filter((s) => s.configured).length}/${Object.keys(statuses).length} configured, ${failed} failing${deep ? " (deep)" : ""}`);
process.exit(failed ? 1 : 0);
