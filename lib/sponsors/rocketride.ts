import path from "node:path";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";
import { errorText, log } from "@/lib/log";
import type { AgentTool } from "@/lib/tools";

// RocketRide: the ops pipeline. rocketride/openstate-ops.pipe is a webhook →
// tool_n8n → response_text graph; the Procurement agent sends a request
// through it and RocketRide runs the n8n "openstate-ops" workflow, so the
// handoff is visible on the RocketRide canvas and in n8n. Optional: without
// ROCKETRIDE_APIKEY there is no run_ops_pipeline tool.

const DEFAULT_URI = "https://api.rocketride.ai";
const DEFAULT_PIPE = "rocketride/openstate-ops.pipe";
const STEP_TIMEOUT_MS = 20_000;
const RUN_TIMEOUT_MS = 60_000;

export const hasRocketRide = () => Boolean(process.env.ROCKETRIDE_APIKEY);
export const uri = () => process.env.ROCKETRIDE_URI || DEFAULT_URI;
export const pipePath = () => path.resolve(process.cwd(), process.env.ROCKETRIDE_PIPE || DEFAULT_PIPE);

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rocketride ${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

/** The text a pipeline result carries, whatever lane name the engine used. */
export function resultText(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result.trim();
  if (typeof result !== "object") return String(result);
  const record = result as Record<string, unknown>;
  for (const key of ["text", "response", "output", "data"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const text = JSON.stringify(record);
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
}

async function client() {
  const { RocketRideClient } = await import("rocketride");
  return new RocketRideClient({
    auth: process.env.ROCKETRIDE_APIKEY,
    uri: uri(),
    requestTimeout: STEP_TIMEOUT_MS,
  });
}

/** Sends `text` through the ops pipeline and returns what came back. */
export async function runPipeline(text: string, { timeoutMs = RUN_TIMEOUT_MS }: { timeoutMs?: number } = {}): Promise<string> {
  if (!hasRocketRide()) throw new Error("ROCKETRIDE_APIKEY is not set");
  const started = performance.now();
  const rr = await client();
  let token: string | undefined;
  try {
    await withTimeout(rr.connect(), STEP_TIMEOUT_MS, "connect");
    const used = await withTimeout(rr.use({ filepath: pipePath(), name: "openstate-ops" }), STEP_TIMEOUT_MS, "use");
    token = used.token;
    const result = await withTimeout(rr.send(token, text, { name: "request.txt" }, "text/plain"), timeoutMs, "send");
    const reply = resultText(result);
    log("rocketride", "ran", { ms: Math.round(performance.now() - started), reply: reply.slice(0, 200) });
    return reply;
  } catch (cause) {
    log("rocketride", "failed", { error: errorText(cause), ms: Math.round(performance.now() - started) });
    throw cause;
  } finally {
    if (token) await rr.terminate(token).catch(() => undefined);
    await rr.disconnect().catch(() => undefined);
  }
}

export function tools(): AgentTool[] {
  if (!hasRocketRide()) return [];
  return [
    {
      name: "run_ops_pipeline",
      description:
        "Send an operations request through the RocketRide ops pipeline (which hands it to the n8n ops workflow): restock orders, supplier follow-ups, anything that is a task for operations rather than a single message. Use only when asked.",
      parameters: {
        type: "object",
        properties: { request: { type: "string", description: "The request, in plain words, with every detail operations needs." } },
        required: ["request"],
        additionalProperties: false,
      },
      run: async (args) => {
        const request = typeof args.request === "string" ? args.request.trim() : "";
        if (!request) return "No request given.";
        try {
          const reply = await runPipeline(request);
          return reply ? `Operations pipeline replied: ${reply}` : "Sent to the operations pipeline.";
        } catch (cause) {
          return `The action failed: ${errorText(cause)}`;
        }
      },
    },
  ];
}

export const sponsor: Sponsor = {
  key: "rocketride",
  name: "RocketRide",
  role: "Ops pipeline (webhook → n8n → response) run from the app with the SDK.",
  env: ["ROCKETRIDE_APIKEY", "ROCKETRIDE_URI", "ROCKETRIDE_PIPE", "ROCKETRIDE_N8N_URL", "ROCKETRIDE_N8N_KEY"],
  configured: hasRocketRide,
  status: async (deep) => {
    if (!hasRocketRide()) return notConfigured("Set ROCKETRIDE_APIKEY (and ROCKETRIDE_N8N_URL/KEY for the pipe) to enable the ops pipeline.");
    if (deep) {
      return checked(async () => ({ detail: `${uri()} · ${pipePath()} · ping replied ${(await runPipeline("ping")) || "(empty)"}` }));
    }
    return checked(async () => {
      const rr = await client();
      try {
        await withTimeout(rr.connect(), STEP_TIMEOUT_MS, "connect");
        return { detail: `${uri()} · ${pipePath()} · connected` };
      } finally {
        await rr.disconnect().catch(() => undefined);
      }
    });
  },
};
