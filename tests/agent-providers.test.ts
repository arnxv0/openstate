import { describe, expect, it } from "vitest";
import type { Turn } from "@/lib/agent-types";
import { salvageJson, toMessages } from "@/lib/groq";
import { toInput } from "@/lib/openai";

const call = { id: "call_1", name: "web_search", arguments: { objective: "x", queries: ["a"] } };
const transcript = (raw: unknown): Turn[] => [
  { role: "user", parts: [{ text: "q" }] },
  { role: "assistant", text: null, calls: [call], raw },
  { role: "tool", results: [{ id: "call_1", name: "web_search", output: "results" }] },
];

describe("openai toInput", () => {
  it("echoes its own output items", () => {
    const own = [{ type: "reasoning", id: "rs_1" }, { type: "function_call", call_id: "call_1", name: "web_search", arguments: "{}" }];
    const input = toInput("sys", transcript(own)) as { type?: string; call_id?: string; output?: string }[];
    expect(input.slice(2, 4)).toEqual(own);
    expect(input.at(-1)).toEqual({ type: "function_call_output", call_id: "call_1", output: "results" });
  });

  it("rebuilds a turn another provider made (Groq tool_calls) from the neutral record", () => {
    const groqRaw = [{ id: "call_1", type: "function", function: { name: "web_search", arguments: "{}" } }];
    const input = toInput("sys", transcript(groqRaw)) as { type?: string; name?: string; arguments?: string }[];
    expect(input[2]).toEqual({
      type: "function_call",
      call_id: "call_1",
      name: "web_search",
      arguments: JSON.stringify(call.arguments),
    });
    expect(input.some((item) => item.type === "function")).toBe(false);
  });
});

describe("groq toMessages", () => {
  it("rebuilds assistant tool calls and tool results as chat messages", () => {
    const messages = toMessages("sys", transcript([{ type: "function_call" }]), 0) as Record<string, unknown>[];
    expect(messages[0]).toEqual({ role: "system", content: "sys" });
    expect(messages[1]).toEqual({ role: "user", content: "q" });
    expect(messages[2]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "web_search", arguments: JSON.stringify(call.arguments) } }],
    });
    expect(messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: "results" });
  });
});

describe("groq salvageJson", () => {
  it("takes the arguments of a bogus json tool call", () => {
    expect(salvageJson('{"name":"json","arguments":{"intent":"question","answer":"Two."}}')).toBe(
      '{"intent":"question","answer":"Two."}',
    );
  });

  it("takes a plain JSON object out of surrounding text, and gives up on none", () => {
    expect(salvageJson('I will answer: {"answer":"ok"} done')).toBe('{"answer":"ok"}');
    expect(salvageJson("nothing here")).toBeNull();
    expect(salvageJson("{not json}")).toBeNull();
  });
});
