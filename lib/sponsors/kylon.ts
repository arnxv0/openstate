import { errorText, log } from "@/lib/log";
import { requestJson } from "@/lib/sponsors/http";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";
import type { AgentTool } from "@/lib/tools";

// Kylon: a proxy to the apps a workspace has connected (Composio-style slugs
// such as GITHUB_GET_REPOSITORY), so Procurement can reach an app that no n8n
// workflow covers yet. The agent searches for a tool, then runs it.
//
// KYLON_API_KEY=pak_…   KYLON_BASE_URL=https://api.kylon.io (default)

const TIMEOUT_MS = 20_000;
const OUTPUT_LIMIT = 6000;
const LIST_LIMIT = 20;

const base = () => (process.env.KYLON_BASE_URL ?? "https://api.kylon.io").replace(/\/$/, "");
const key = () => process.env.KYLON_API_KEY?.trim() || null;
const configured = () => key() !== null;
const headers = () => ({ "x-api-key": key() ?? "" });

type SearchItem = { slug?: string; name?: string; tool?: string; description?: string; toolkit?: string };

/** Search results as "SLUG — description" lines, at most LIST_LIMIT. */
export function formatSearch(body: unknown): string {
  const list = Array.isArray(body)
    ? body
    : body && typeof body === "object"
      ? ((body as { tools?: unknown; results?: unknown; items?: unknown; data?: unknown }).tools ??
        (body as { results?: unknown }).results ??
        (body as { items?: unknown }).items ??
        (body as { data?: unknown }).data ??
        [])
      : [];
  if (!Array.isArray(list) || list.length === 0) return "No tools match.";
  const lines = (list as SearchItem[])
    .map((item) => {
      const slug = item.slug ?? item.tool ?? item.name;
      if (!slug) return null;
      const description = (item.description ?? "").replace(/\s+/g, " ").trim();
      return `${slug}${item.toolkit ? ` [${item.toolkit}]` : ""}${description ? ` — ${description.slice(0, 140)}` : ""}`;
    })
    .filter((line): line is string => line !== null);
  const shown = lines.slice(0, LIST_LIMIT);
  return lines.length > LIST_LIMIT ? `${shown.join("\n")}\n… ${lines.length - LIST_LIMIT} more` : shown.join("\n");
}

/** An execution result for the model: failures spelled out, data as compact JSON. */
export function formatResult(body: unknown): string {
  const result = (body ?? {}) as { successful?: boolean; success?: boolean; error?: string | null; data?: unknown };
  if (result.successful === false || result.success === false || (result.error && !result.data)) {
    return `The action failed${result.error ? `: ${result.error}` : "."}`;
  }
  const text = JSON.stringify(result.data ?? result);
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}… (truncated)` : text;
}

type Connections = { connections?: { toolkit?: string; name?: string; slug?: string; status?: string }[] } | unknown[];

export const sponsor: Sponsor = {
  key: "kylon",
  name: "Kylon",
  role: "Tool proxy to the workspace's connected apps, for actions no n8n workflow covers",
  env: ["KYLON_API_KEY", "KYLON_BASE_URL"],
  configured,
  status: async () => {
    if (!configured()) return notConfigured("set KYLON_API_KEY (pak_…)");
    return checked(async () => {
      const body = await requestJson<Connections>(`${base()}/proxy/tools/connections`, { headers: headers(), timeoutMs: 10_000 });
      const list = Array.isArray(body) ? body : (body?.connections ?? []);
      const names = (list as { toolkit?: string; name?: string; slug?: string }[])
        .map((item) => item.toolkit ?? item.slug ?? item.name)
        .filter((name): name is string => Boolean(name));
      return { detail: names.length ? `${names.length} connected: ${names.slice(0, 10).join(", ")}` : "key accepted, no apps connected yet" };
    });
  },
};

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function tools(): AgentTool[] {
  if (!configured()) return [];
  return [
    {
      name: "search_app_tools",
      description:
        "Find an action in the household's connected apps (Kylon) by keywords, e.g. 'create google task', 'send slack message'. Returns tool slugs to pass to run_app_tool.",
      parameters: {
        type: "object",
        properties: { keywords: { type: "string", description: "What the action should do, a few words." } },
        required: ["keywords"],
        additionalProperties: false,
      },
      run: async (args) => {
        const keywords = str(args.keywords);
        if (!keywords) return "Give keywords.";
        try {
          const body = await requestJson<unknown>(`${base()}/proxy/tools/search?keywords=${encodeURIComponent(keywords)}`, {
            headers: headers(),
            timeoutMs: TIMEOUT_MS,
          });
          return formatSearch(body);
        } catch (cause) {
          log("kylon", "search failed", { keywords, error: errorText(cause) });
          return `The search failed: ${errorText(cause)}`;
        }
      },
    },
    {
      name: "run_app_tool",
      description: "Run one connected-app action by slug (from search_app_tools) with its arguments. Only when the person asked for the action.",
      parameters: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Tool slug, e.g. GOOGLETASKS_INSERT_TASK." },
          arguments: { type: "object", description: "The tool's input fields." },
        },
        required: ["tool"],
        additionalProperties: false,
      },
      run: async (args) => {
        const tool = str(args.tool).toUpperCase();
        if (!tool) return "Give a tool slug.";
        const input = args.arguments && typeof args.arguments === "object" ? (args.arguments as Record<string, unknown>) : {};
        const started = performance.now();
        try {
          const body = await requestJson<unknown>(`${base()}/proxy/tools/execute`, {
            method: "POST",
            headers: headers(),
            body: { tool, arguments: input },
            timeoutMs: TIMEOUT_MS,
          });
          const text = formatResult(body);
          log("kylon", "ran", { tool, ok: !text.startsWith("The action failed"), ms: Math.round(performance.now() - started) });
          return text;
        } catch (cause) {
          log("kylon", "failed", { tool, error: errorText(cause) });
          return `The action failed: ${errorText(cause)}`;
        }
      },
    },
  ];
}
