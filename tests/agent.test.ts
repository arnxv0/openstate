import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StepRequest, StepResult } from "@/lib/agent-types";

const steps: ((request: StepRequest) => StepResult)[] = [];
const generateJson = vi.fn();

vi.mock("@/lib/llm", () => ({
  supportsTools: () => true,
  generateJson: (request: unknown) => generateJson(request),
  stepWithTools: async (request: StepRequest) => {
    const next = steps.shift();
    if (!next) throw new Error("no scripted step left");
    return next(request);
  },
}));

const { parseJsonLoosely, runAgent } = await import("@/lib/agent");

const usage = { input: 10, output: 5, total: 15 };
const reply = (text: string): StepResult => ({ text, calls: [], raw: [], model: "test", usage, latencyMs: 1 });

describe("parseJsonLoosely", () => {
  it("accepts plain JSON, fenced JSON and JSON inside a sentence", () => {
    expect(parseJsonLoosely('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoosely('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoosely('Here you go: {"a":{"b":2}} ok')).toEqual({ a: { b: 2 } });
  });

  it("refuses text with no object in it", () => {
    expect(() => parseJsonLoosely("no json here")).toThrow(/did not return JSON/);
  });
});

describe("runAgent", () => {
  beforeEach(() => {
    steps.length = 0;
    generateJson.mockReset();
  });

  const echo = {
    name: "echo",
    description: "returns its input",
    parameters: { type: "object" as const, properties: { text: { type: "string" } } },
    run: async (args: Record<string, unknown>) => `echo:${String(args.text)}`,
  };

  it("runs tool calls, feeds results back and returns the final JSON", async () => {
    steps.push(
      (request) => {
        expect(request.transcript).toHaveLength(1);
        expect(request.tools.map((tool) => tool.name)).toEqual(["echo"]);
        return { text: null, calls: [{ id: "c1", name: "echo", arguments: { text: "hi" } }], raw: [{ type: "function_call" }], model: "test", usage, latencyMs: 1 };
      },
      (request) => {
        const last = request.transcript.at(-1);
        expect(last).toEqual({ role: "tool", results: [{ id: "c1", name: "echo", output: "echo:hi" }] });
        return reply('{"answer":"done"}');
      },
    );
    const run = await runAgent<{ answer: string }>({ system: "s", parts: [{ text: "q" }], tools: [echo] });
    expect(run.data).toEqual({ answer: "done" });
    expect(run.steps).toBe(2);
    expect(run.tools).toEqual([{ name: "echo", arguments: { text: "hi" }, output: "echo:hi", ms: expect.any(Number) }]);
    expect(run.usage).toEqual({ input: 20, output: 10, total: 30 });
  });

  it("tells the model about unknown tools and tool failures instead of throwing", async () => {
    const broken = { ...echo, name: "broken", run: async () => { throw new Error("boom"); } };
    steps.push(
      () => ({
        text: null,
        calls: [
          { id: "c1", name: "nope", arguments: {} },
          { id: "c2", name: "broken", arguments: {} },
        ],
        raw: [],
        model: "test",
        usage,
        latencyMs: 1,
      }),
      (request) => {
        const last = request.transcript.at(-1);
        expect(last?.role === "tool" && last.results.map((r) => r.output)).toEqual([
          'Unknown tool "nope".',
          "The tool failed: boom",
        ]);
        return reply('{"answer":"sorry"}');
      },
    );
    const run = await runAgent<{ answer: string }>({ system: "s", parts: [{ text: "q" }], tools: [echo, broken] });
    expect(run.data.answer).toBe("sorry");
  });

  it("forces an answer on the last step", async () => {
    steps.push(
      () => ({ text: null, calls: [{ id: "c1", name: "echo", arguments: { text: "1" } }], raw: [], model: "test", usage, latencyMs: 1 }),
      (request) => {
        expect(request.toolChoice).toBe("none");
        return reply('{"answer":"forced"}');
      },
    );
    const run = await runAgent<{ answer: string }>({ system: "s", parts: [{ text: "q" }], tools: [echo], maxSteps: 2 });
    expect(run.data.answer).toBe("forced");
    expect(run.steps).toBe(2);
  });

  it("answers in one plain call when there are no tools", async () => {
    generateJson.mockResolvedValue({ data: { answer: "plain" }, model: "m", usage, latencyMs: 1 });
    const run = await runAgent<{ answer: string }>({ system: "s", parts: [{ text: "q" }], tools: [] });
    expect(run.data.answer).toBe("plain");
    expect(run.steps).toBe(1);
    expect(generateJson).toHaveBeenCalledOnce();
  });
});
