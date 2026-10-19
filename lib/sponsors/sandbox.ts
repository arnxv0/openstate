import * as celesto from "@/lib/sponsors/celesto";
import * as tenki from "@/lib/sponsors/tenki";

// One interface over the two sandbox sponsors. SANDBOX_PROVIDER=tenki|celesto
// picks one; otherwise whichever key is set, Tenki first. Every call gets a
// fresh VM that is torn down afterwards, whatever happens.

export type SandboxProvider = "tenki" | "celesto";

export type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  provider: SandboxProvider;
  ms: number;
};

export function provider(): SandboxProvider | null {
  const forced = process.env.SANDBOX_PROVIDER;
  if (forced === "tenki" && tenki.hasTenki()) return "tenki";
  if (forced === "celesto" && celesto.hasCelesto()) return "celesto";
  if (tenki.hasTenki()) return "tenki";
  if (celesto.hasCelesto()) return "celesto";
  return null;
}

export const hasSandbox = () => provider() !== null;

const JOB_DIR = "/tmp/job";
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/**
 * The bash command that lands the script (and any data files) in the VM and
 * runs it. Everything travels base64-encoded, so quotes, dollars and heredoc
 * markers in the script can never break out of the command.
 */
export function pythonCommand(script: string, files: Record<string, string> = {}) {
  const lines = [`set -e`, `mkdir -p ${JOB_DIR}`, `cd ${JOB_DIR}`];
  for (const [name, content] of Object.entries(files)) {
    if (!SAFE_NAME.test(name)) throw new Error(`unsafe file name: ${name}`);
    lines.push(`echo ${b64(content)} | base64 -d > ${name}`);
  }
  lines.push(`echo ${b64(script)} | base64 -d > job.py`);
  lines.push(`python3 job.py`);
  return lines.join("\n");
}

/** Runs a Python script (stdlib only) in a fresh sandbox, with optional data files beside it. */
export async function runPython(
  script: string,
  { timeoutMs = 60_000, files }: { timeoutMs?: number; files?: Record<string, string> } = {},
): Promise<RunResult> {
  const active = provider();
  if (!active) throw new Error("No sandbox configured: set TENKI_API_KEY or CELESTO_API_KEY");
  const command = pythonCommand(script, files);
  const result = active === "tenki" ? await tenki.run(command, timeoutMs) : await celesto.run(command, timeoutMs);
  return { ...result, provider: active };
}
