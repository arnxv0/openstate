import { Computer } from "@celestoai/sdk";
import { log } from "@/lib/log";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";

// Celesto AI: sandboxed computers with the same shape as Tenki, so either can
// run the research agent's scripts. One computer per call, deleted after.

export type CelestoRunResult = { stdout: string; stderr: string; exitCode: number; ms: number };

export const hasCelesto = () => Boolean(process.env.CELESTO_API_KEY);

/** Runs one bash command in a fresh computer and deletes it. */
export async function run(command: string, timeoutMs: number): Promise<CelestoRunResult> {
  if (!hasCelesto()) throw new Error("CELESTO_API_KEY is not set");
  const started = performance.now();
  const computer = await Computer.create({ templateId: "scratch" }, { token: process.env.CELESTO_API_KEY });
  try {
    // Celesto's timeout is in seconds, capped at 300.
    const timeout = Math.max(1, Math.min(300, Math.ceil(timeoutMs / 1000)));
    const result = await computer.run(`bash -lc ${JSON.stringify(command)}`, { timeout });
    const ms = Math.round(performance.now() - started);
    log("sandbox", "celesto ran", { exitCode: result.exitCode, timedOut: result.timedOut ?? false, ms });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, ms };
  } finally {
    await computer.delete().catch(() => {});
  }
}

export const sponsor: Sponsor = {
  key: "celesto",
  name: "Celesto AI",
  role: "Sandboxed computers for the research agent's scripts (alternative to Tenki)",
  env: ["CELESTO_API_KEY"],
  configured: hasCelesto,
  status: async (deep = false) => {
    if (!hasCelesto()) return notConfigured("CELESTO_API_KEY not set");
    if (!deep) return { configured: true, ok: true, detail: "key set; add --deep to boot a computer" };
    return checked(async () => {
      const result = await run("echo ok", 30_000);
      if (result.stdout.trim() !== "ok") throw new Error(`unexpected output: ${result.stdout.slice(0, 80)}`);
      return { detail: `computer created, ran echo, deleted in ${result.ms} ms` };
    });
  },
};
