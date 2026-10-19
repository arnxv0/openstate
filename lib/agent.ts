import type { Part, ToolResult, Turn, Usage } from "@/lib/agent-types";
import { generateJson, stepWithTools, supportsTools } from "@/lib/llm";
import { errorText, log } from "@/lib/log";
import type { AgentTool } from "@/lib/tools";

// The answer agent's loop: the model reads the prompt, may call tools (memory,
// events, the web, Composio actions), reads what they return and answers with
// the JSON the caller asked for. Runs in-process, inside the request, with
// whichever provider lib/llm.ts picks. Gemini has no tool support here, so it
// answers from the prompt alone, as before.

export type ToolTrace = { name: string; arguments: Record<string, unknown>; output: string; ms: number };

export type AgentRun<T> = {
  data: T;
  model: string;
  usage: Usage;
  /** Model calls made, including the one that answered. */
  steps: number;
  tools: ToolTrace[];
  latencyMs: number;
};

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS ?? 6);
const OUTPUT_LIMIT = 8000;

/** JSON from a model reply that may carry code fences or a sentence around it. */
export function parseJsonLoosely<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error(`model did not return JSON: ${trimmed.slice(0, 120)}`);
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }
}

export async function runAgent<T>({
  system,
  parts,
  tools,
  maxSteps = MAX_STEPS,
  timeoutMs,
  reasoning,
}: {
  system: string;
  parts: Part[];
  tools: AgentTool[];
  maxSteps?: number;
  timeoutMs?: number;
  reasoning?: string;
}): Promise<AgentRun<T>> {
  const started = performance.now();
  if (tools.length === 0 || !supportsTools()) {
    const result = await generateJson<T>({ system, parts, timeoutMs, reasoning });
    return { data: result.data, model: result.model, usage: result.usage, steps: 1, tools: [], latencyMs: Math.round(performance.now() - started) };
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const specs = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const transcript: Turn[] = [{ role: "user", parts }];
  const trace: ToolTrace[] = [];
  const usage: Usage = { input: 0, output: 0, total: 0 };
  let model = "";

  for (let step = 1; step <= maxSteps; step++) {
    const last = step === maxSteps;
    const result = await stepWithTools({
      system,
      transcript,
      tools: specs,
      toolChoice: last ? "none" : "auto",
      timeoutMs,
      reasoning,
    });
    usage.input += result.usage.input;
    usage.output += result.usage.output;
    usage.total += result.usage.total;
    model = result.model;

    if (result.calls.length === 0 || last) {
      if (!result.text) throw new Error("model returned neither an answer nor a tool call");
      return {
        data: parseJsonLoosely<T>(result.text),
        model,
        usage,
        steps: step,
        tools: trace,
        latencyMs: Math.round(performance.now() - started),
      };
    }

    transcript.push({ role: "assistant", text: result.text, calls: result.calls, raw: result.raw });
    const results: ToolResult[] = await Promise.all(
      result.calls.map(async (call) => {
        const tool = byName.get(call.name);
        const began = performance.now();
        let output: string;
        if (!tool) {
          output = `Unknown tool "${call.name}".`;
        } else {
          try {
            output = await tool.run(call.arguments);
          } catch (cause) {
            output = `The tool failed: ${errorText(cause)}`;
          }
        }
        if (output.length > OUTPUT_LIMIT) output = `${output.slice(0, OUTPUT_LIMIT)}… (truncated)`;
        const ms = Math.round(performance.now() - began);
        trace.push({ name: call.name, arguments: call.arguments, output, ms });
        log("agent", "tool", { step, tool: call.name, arguments: call.arguments, ms, output: output.slice(0, 300) });
        return { id: call.id, name: call.name, output };
      }),
    );
    transcript.push({ role: "tool", results });
  }
  throw new Error("agent loop ended without an answer");
}
