// Shared shapes for the tool-calling loop (lib/agent.ts) and the providers
// that drive it (lib/openai.ts, lib/groq.ts). Types only: no imports, so any
// module can use them without pulling a provider in.

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** A tool as the model sees it. */
export type ToolSpec = { name: string; description: string; parameters: JsonSchema };

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };

export type ToolResult = { id: string; name: string; output: string };

/**
 * The conversation so far, provider-neutral. `raw` on an assistant turn is
 * whatever the provider returned, handed back verbatim on the next step
 * (OpenAI's Responses API needs its own items echoed; Groq its tool_calls).
 */
export type Turn =
  | { role: "user"; parts: Part[] }
  | { role: "assistant"; text: string | null; calls: ToolCall[]; raw: unknown }
  | { role: "tool"; results: ToolResult[] };

export type StepRequest = {
  system: string;
  transcript: Turn[];
  tools: ToolSpec[];
  /** "none" on the last step: the tools stay declared (earlier calls refer to them) but the model must answer. */
  toolChoice?: "auto" | "none";
  timeoutMs?: number;
  reasoning?: string;
};

export type Usage = { input: number; output: number; total: number };

export type StepResult = {
  text: string | null;
  calls: ToolCall[];
  raw: unknown;
  model: string;
  usage: Usage;
  latencyMs: number;
};
