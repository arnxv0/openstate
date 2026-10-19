import { envMap, requestJson } from "@/lib/sponsors/http";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";
import { errorText, log } from "@/lib/log";
import type { AgentTool } from "@/lib/tools";

// n8n: the company's hands. Each action is an n8n workflow that starts with a
// Webhook node and ends with Respond to Webhook (importable templates live in
// n8n/). The Procurement agent POSTs JSON to the workflow; n8n holds the
// Google Tasks, Slack, Calendar and Gmail credentials, so the app never sees
// them. Optional: without N8N_WEBHOOK_BASE there are no action tools.

const TIMEOUT_MS = 15_000;

export type WorkflowName = "shopping" | "alert" | "reminder" | "email" | "ops" | "health";

const DEFAULT_PATHS: Record<WorkflowName, string> = {
  shopping: "openstate-shopping-list",
  alert: "openstate-alert",
  reminder: "openstate-reminder",
  email: "openstate-email",
  ops: "openstate-ops",
  health: "openstate-health",
};

export const WORKFLOW_NAMES = Object.keys(DEFAULT_PATHS) as WorkflowName[];

const base = () => (process.env.N8N_WEBHOOK_BASE ?? "").trim().replace(/\/+$/, "");

export const hasN8n = () => Boolean(base()) || WORKFLOW_NAMES.some((name) => envMap("N8N_WORKFLOWS")[name]);

/**
 * Full URL of a workflow: N8N_WORKFLOWS="shopping=https://…" wins, else the
 * default path under N8N_WEBHOOK_BASE (which may or may not end in /webhook).
 */
export function workflowUrl(name: WorkflowName): string | null {
  const override = envMap("N8N_WORKFLOWS")[name];
  if (override) return override;
  const root = base();
  if (!root) return null;
  return `${root}${root.endsWith("/webhook") ? "" : "/webhook"}/${DEFAULT_PATHS[name]}`;
}

/** Secrets and hostnames stay readable in health output; tokens do not. */
export function maskUrl(url: string) {
  return url.replace(/([?&](?:token|key|secret)=)[^&]+/gi, "$1…");
}

/** Runs one workflow with a JSON body; returns whatever it responded with. */
export async function run(name: WorkflowName, payload: Record<string, unknown>): Promise<unknown> {
  const url = workflowUrl(name);
  if (!url) throw new Error(`n8n workflow "${name}" is not configured`);
  const secret = process.env.N8N_WEBHOOK_SECRET;
  const started = performance.now();
  try {
    const result = await requestJson<unknown>(url, {
      method: "POST",
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      body: payload,
      timeoutMs: TIMEOUT_MS,
    });
    log("n8n", "ran", { workflow: name, ms: Math.round(performance.now() - started) });
    return result;
  } catch (cause) {
    log("n8n", "failed", { workflow: name, error: errorText(cause), ms: Math.round(performance.now() - started) });
    throw cause;
  }
}

/** The workflow's reply as something the model can read; empty when it said nothing useful. */
export function describeResponse(response: unknown) {
  if (response === undefined || response === null || response === "") return "";
  if (typeof response === "string") return response.trim().slice(0, 500);
  const text = JSON.stringify(response);
  return text === "{}" || text === "[]" ? "" : text.slice(0, 500);
}

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];

/** Wraps a workflow call so the model reads plain words, never an exception. */
async function act(name: WorkflowName, payload: Record<string, unknown>, done: string) {
  try {
    const reply = describeResponse(await run(name, payload));
    return reply ? `${done} ${reply}` : done;
  } catch (cause) {
    return `The action failed: ${errorText(cause)}`;
  }
}

export function tools(): AgentTool[] {
  if (!hasN8n()) return [];
  const available: AgentTool[] = [];
  if (workflowUrl("shopping")) {
    available.push({
      name: "add_to_shopping_list",
      description: "Add items to the household shopping list (Google Tasks, through n8n). Use only when asked to add, list or buy something.",
      parameters: {
        type: "object",
        properties: {
          items: { type: "array", items: { type: "string" }, description: "Item names, one per entry." },
          note: { type: "string", description: "Optional note, e.g. why or how many." },
        },
        required: ["items"],
        additionalProperties: false,
      },
      run: async (args) => {
        const items = list(args.items);
        if (items.length === 0) return "No items given.";
        return act("shopping", { items, note: str(args.note) || undefined }, `Added ${items.length} item${items.length === 1 ? "" : "s"} to the shopping list: ${items.join(", ")}.`);
      },
    });
  }
  if (workflowUrl("alert")) {
    available.push({
      name: "send_alert",
      description: "Send a message to the household's Slack (through n8n): low stock, something taken, something going off. Use only when asked to tell or alert someone.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message, in plain words." },
          channel: { type: "string", description: "Optional Slack channel; the workflow's default otherwise." },
        },
        required: ["message"],
        additionalProperties: false,
      },
      run: async (args) => {
        const message = str(args.message);
        if (!message) return "No message given.";
        return act("alert", { message, channel: str(args.channel) || undefined }, "Sent the alert to Slack.");
      },
    });
  }
  if (workflowUrl("reminder")) {
    available.push({
      name: "create_reminder",
      description: "Create a reminder on the household calendar (Google Calendar, through n8n): medication, expiry, restock. Use only when asked to remind.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What to remind about." },
          when_iso: { type: "string", description: "Start time as ISO 8601, e.g. 2026-10-20T09:00:00-07:00." },
          notes: { type: "string", description: "Optional details." },
        },
        required: ["title", "when_iso"],
        additionalProperties: false,
      },
      run: async (args) => {
        const title = str(args.title);
        const when = str(args.when_iso);
        if (!title || !when) return "A title and a time are needed.";
        if (Number.isNaN(Date.parse(when))) return `"${when}" is not a time I can set.`;
        return act("reminder", { title, when_iso: when, notes: str(args.notes) || undefined }, `Set a reminder "${title}" for ${when}.`);
      },
    });
  }
  if (workflowUrl("email")) {
    available.push({
      name: "send_email",
      description: "Send an email (Gmail, through n8n), e.g. the shopping list to someone. Use only when asked to email.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient address." },
          subject: { type: "string" },
          body: { type: "string", description: "Plain-text body." },
        },
        required: ["to", "subject", "body"],
        additionalProperties: false,
      },
      run: async (args) => {
        const to = str(args.to);
        const subject = str(args.subject);
        const body = str(args.body);
        if (!to || !subject || !body) return "A recipient, a subject and a body are needed.";
        return act("email", { to, subject, body }, `Emailed ${to}: "${subject}".`);
      },
    });
  }
  return available;
}

export const sponsor: Sponsor = {
  key: "n8n",
  name: "n8n",
  role: "Workflows that act: shopping list, Slack alerts, calendar reminders, email.",
  env: ["N8N_WEBHOOK_BASE", "N8N_WEBHOOK_SECRET", "N8N_WORKFLOWS"],
  configured: hasN8n,
  status: async (deep) => {
    if (!hasN8n()) return notConfigured("Set N8N_WEBHOOK_BASE (or N8N_WORKFLOWS) to enable actions.");
    const configured = WORKFLOW_NAMES.map((name) => [name, workflowUrl(name)] as const).filter((entry): entry is readonly [WorkflowName, string] => Boolean(entry[1]));
    const detail = configured.map(([name, url]) => `${name}=${maskUrl(url)}`).join(" ");
    if (!deep) return { configured: true, ok: true, detail };
    return checked(async () => {
      const reply = describeResponse(await run("health", { ping: true, at: new Date().toISOString() }));
      return { detail: `${detail} · health replied ${reply || "(empty)"}` };
    });
  },
};
