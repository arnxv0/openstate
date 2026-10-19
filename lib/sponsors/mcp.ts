import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { JsonSchema } from "@/lib/agent-types";
import { errorText, log } from "@/lib/log";
import { checked, notConfigured, type Sponsor } from "@/lib/sponsors/registry";
import type { AgentTool } from "@/lib/tools";

// MCP bridge: any sponsor that speaks the Model Context Protocol becomes a
// set of tools for the agents, with no per-sponsor code. Servers are listed in
// MCP_SERVERS as name=target pairs; a target is an http(s) URL (Streamable
// HTTP) or "stdio:<command line>" for a local server. A bearer token for an
// HTTP server comes from MCP_TOKEN_<NAME>. Tools are exposed to the roster
// as "mcp_<server>_<tool>", and a profile may ask for "mcp:<server>" to get
// all of them (see lib/company/tools.ts).
//
//   MCP_SERVERS=rocketride=https://api.rocketride.ai/mcp,tenki=stdio:npx -y @tenkicloud/mcp
//   MCP_TOKEN_ROCKETRIDE=rr_...

export type ServerSpec = { name: string; kind: "http" | "stdio"; target: string };

const CALL_TIMEOUT_MS = Number(process.env.MCP_CALL_TIMEOUT_MS ?? 60_000);
const LIST_TTL_MS = 5 * 60_000;
const OUTPUT_LIMIT = 8000;

/** MCP_SERVERS parsed; malformed entries dropped. Pure. */
export function parseServers(value = process.env.MCP_SERVERS ?? ""): ServerSpec[] {
  const specs: ServerSpec[] = [];
  for (const pair of value.split(",")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const name = pair.slice(0, index).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const target = pair.slice(index + 1).trim();
    if (!name || !target) continue;
    if (/^https?:\/\//.test(target)) specs.push({ name, kind: "http", target });
    else if (target.startsWith("stdio:") && target.slice(6).trim()) specs.push({ name, kind: "stdio", target: target.slice(6).trim() });
  }
  return specs;
}

export const hasMcp = () => parseServers().length > 0;

/** "mcp_<server>_<tool>", safe for every model's tool-name rules. Pure. */
export const toolName = (server: string, tool: string) =>
  `mcp_${server}_${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/** The text an agent reads from a tool result. Pure. */
export function resultText(result: { content?: unknown; isError?: boolean; structuredContent?: unknown }) {
  const parts = Array.isArray(result.content) ? result.content : [];
  const text = parts
    .map((part) => {
      const item = part as { type?: string; text?: string; data?: string; mimeType?: string; uri?: string };
      if (item.type === "text" && typeof item.text === "string") return item.text;
      if (item.type === "resource" || item.uri) return `[resource ${item.uri ?? ""}]`;
      if (item.mimeType) return `[${item.mimeType} content]`;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
  const body = text || (result.structuredContent ? JSON.stringify(result.structuredContent) : "(no output)");
  const clipped = body.length > OUTPUT_LIMIT ? `${body.slice(0, OUTPUT_LIMIT)}… (truncated)` : body;
  return result.isError ? `The tool failed: ${clipped}` : clipped;
}

const tokenFor = (name: string) => process.env[`MCP_TOKEN_${name.toUpperCase().replace(/-/g, "_")}`];

type Connection = { client: Client; tools: ToolInfo[]; listedAt: number };
type ToolInfo = { name: string; description?: string; inputSchema?: unknown };

const connections = new Map<string, Promise<Connection>>();

async function connect(spec: ServerSpec): Promise<Connection> {
  const { Client: McpClient } = await import("@modelcontextprotocol/sdk/client/index.js");
  const client = new McpClient({ name: "openstate", version: "0.1.0" });
  if (spec.kind === "http") {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const token = tokenFor(spec.name);
    const transport = new StreamableHTTPClientTransport(new URL(spec.target), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    });
    await client.connect(transport);
  } else {
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const [command, ...args] = spec.target.split(/\s+/);
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const transport = new StdioClientTransport({ command, args, env, stderr: "ignore" });
    await client.connect(transport);
  }
  const { tools } = await client.listTools();
  log("mcp", "connected", { server: spec.name, kind: spec.kind, tools: tools.length });
  return { client, tools: tools as ToolInfo[], listedAt: Date.now() };
}

/** A live connection per server for the life of the process; a failed one is dropped so the next call retries. */
function connection(spec: ServerSpec) {
  let pending = connections.get(spec.name);
  if (!pending) {
    pending = connect(spec);
    pending.catch(() => connections.delete(spec.name));
    connections.set(spec.name, pending);
  }
  return pending;
}

const withTimeout = <T,>(promise: Promise<T>, ms: number, what: string) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)),
  ]);

function toSchema(schema: unknown): JsonSchema {
  if (schema && typeof schema === "object" && (schema as { type?: string }).type === "object") return schema as JsonSchema;
  return { type: "object", properties: {} };
}

/** Every tool from every configured server, as AgentTools. Servers that cannot be reached contribute nothing. */
export async function mcpTools(): Promise<AgentTool[]> {
  const specs = parseServers();
  if (specs.length === 0) return [];
  const lists = await Promise.all(
    specs.map(async (spec) => {
      try {
        let live = await withTimeout(connection(spec), 15_000, `mcp ${spec.name} connect`);
        if (Date.now() - live.listedAt > LIST_TTL_MS) {
          const { tools } = await live.client.listTools();
          live = { ...live, tools: tools as ToolInfo[], listedAt: Date.now() };
          connections.set(spec.name, Promise.resolve(live));
        }
        return live.tools.map((tool): AgentTool => ({
          name: toolName(spec.name, tool.name),
          description: `[${spec.name} via MCP] ${tool.description ?? tool.name}`.slice(0, 1000),
          parameters: toSchema(tool.inputSchema),
          run: async (args) => {
            const started = performance.now();
            try {
              const conn = await connection(spec);
              const result = await withTimeout(conn.client.callTool({ name: tool.name, arguments: args }), CALL_TIMEOUT_MS, tool.name);
              const text = resultText(result as Parameters<typeof resultText>[0]);
              log("mcp", "tool", { server: spec.name, tool: tool.name, ms: Math.round(performance.now() - started), ok: !text.startsWith("The tool failed") });
              return text;
            } catch (cause) {
              connections.delete(spec.name);
              log("mcp", "tool failed", { server: spec.name, tool: tool.name, error: errorText(cause) });
              return `The tool failed: ${errorText(cause)}`;
            }
          },
        }));
      } catch (cause) {
        log("mcp", "server unavailable", { server: spec.name, error: errorText(cause) });
        return [];
      }
    }),
  );
  return lists.flat();
}

export const sponsor: Sponsor = {
  key: "mcp",
  name: "MCP bridge",
  role: "Turns any sponsor's MCP server (RocketRide, Tenki, n8n, Masky, …) into agent tools with no extra code.",
  env: ["MCP_SERVERS", "MCP_TOKEN_<NAME>", "MCP_CALL_TIMEOUT_MS"],
  configured: hasMcp,
  status: async () => {
    const specs = parseServers();
    if (specs.length === 0) return notConfigured("MCP_SERVERS not set (name=https://… or name=stdio:<command>)");
    return checked(async () => {
      const reports = await Promise.all(
        specs.map(async (spec) => {
          try {
            const live = await withTimeout(connection(spec), 15_000, `${spec.name} connect`);
            return `${spec.name}: ${live.tools.length} tools`;
          } catch (cause) {
            connections.delete(spec.name);
            return `${spec.name}: FAILED (${errorText(cause).slice(0, 80)})`;
          }
        }),
      );
      const failed = reports.filter((line) => line.includes("FAILED"));
      if (failed.length === specs.length) throw new Error(reports.join("; "));
      return { detail: reports.join("; ") };
    });
  },
};
