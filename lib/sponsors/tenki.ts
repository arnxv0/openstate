import { stderrText, stdoutText, TenkiSandbox } from "@tenkicloud/sandbox";
import { log } from "@/lib/log";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";

// Tenki Sandbox: a disposable Linux VM per call. The research agent runs its
// scripts here, so nothing the web returns ever runs on the server. One VM is
// created, the command runs, the VM is closed, every time.

const BOOT_TIMEOUT_MS = 180_000;

export type TenkiRunResult = { stdout: string; stderr: string; exitCode: number; ms: number };

export const hasTenki = () => Boolean(process.env.TENKI_API_KEY);

/** Runs one bash command in a fresh VM and tears it down. */
export async function run(command: string, timeoutMs: number): Promise<TenkiRunResult> {
  if (!hasTenki()) throw new Error("TENKI_API_KEY is not set");
  const started = performance.now();
  const sandbox = new TenkiSandbox({ authToken: process.env.TENKI_API_KEY });
  const session = await sandbox.createAndWait({ name: "openstate", timeoutMs: BOOT_TIMEOUT_MS });
  try {
    const result = await session.exec("bash", { args: ["-lc", command], timeoutMs });
    const ms = Math.round(performance.now() - started);
    log("sandbox", "tenki ran", { exitCode: result.exitCode, status: result.status, ms });
    return { stdout: stdoutText(result), stderr: stderrText(result), exitCode: result.exitCode, ms };
  } finally {
    await session.close().catch(() => {});
    sandbox.close();
  }
}

export const sponsor: Sponsor = {
  key: "tenki",
  name: "Tenki",
  role: "Disposable Linux VMs for the research agent's scripts",
  env: ["TENKI_API_KEY"],
  configured: hasTenki,
  status: async (deep = false) => {
    if (!hasTenki()) return notConfigured("TENKI_API_KEY not set");
    if (!deep) return { configured: true, ok: true, detail: "key set; add --deep to boot a VM" };
    return checked(async () => {
      const result = await run("echo ok", 30_000);
      if (result.stdout.trim() !== "ok") throw new Error(`unexpected output: ${result.stdout.slice(0, 80)}`);
      return { detail: `VM booted, ran echo, closed in ${result.ms} ms` };
    });
  },
};
