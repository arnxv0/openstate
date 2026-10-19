// End-to-end check of the demo flow against a running dev server, using your
// own photos. It writes to the real database, so use a throwaway site name.
//
//   node scripts/demo-check.ts <before.jpg> <after.jpg> [site=table] [item="coke can"] [base=http://localhost:3000]
//
// 1. Observer 01 says "remember this <site>" while looking at <before.jpg>.
// 2. Observer 02's watcher sends an episode whose last frame is <after.jpg>.
// 3. Observer 01, looking at nothing, asks how many <item> are left.
import { readFileSync } from "node:fs";

const [before, after, site = "table", item = "coke can", base = "http://localhost:3000"] = process.argv.slice(2);
if (!before || !after) {
  console.error('usage: node scripts/demo-check.ts <before.jpg> <after.jpg> [site] [item] [base]');
  process.exit(1);
}
const image = (path: string) => readFileSync(path).toString("base64");

async function post(path: string, body: unknown) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, ms: Math.round(performance.now() - started), json };
}

const register = await post("/api/ask", {
  observerId: "01",
  text: `Hey World, remember this ${site}`,
  image: image(before),
});
console.log(`1. register  ${register.status} ${register.ms}ms  anchor=${register.json.anchor}  "${register.json.answer}"`);

const now = Date.now();
const episode = await post("/api/episodes", {
  observerId: "02",
  trigger: `${site} · demo-check`,
  site,
  frames: [
    { image: image(before), at: now - 4000, phase: "pre" },
    { image: image(after), at: now, phase: "after" },
  ],
  stats: { durationMs: 4000, framesCaptured: 2, framesDiscarded: 0, detections: 2 },
});
console.log(
  `2. episode   ${episode.status} ${episode.ms}ms  site=${episode.json.container} identity=${episode.json.identity ?? episode.json.skipped}  changes=${JSON.stringify(episode.json.changes)}`,
);
console.log(`   inventory ${JSON.stringify(episode.json.inventory)}`);

const question = await post("/api/ask", {
  observerId: "01",
  text: `Hey World, how many ${item}s are left ${site === "fridge" ? "in" : "on"} the ${site}?`,
});
console.log(`3. question  ${question.status} ${question.ms}ms  "${question.json.answer}"`);
