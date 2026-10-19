import { afterEach, describe, expect, it, vi } from "vitest";
import { isLiteModel, provider } from "@/lib/llm";

afterEach(() => vi.unstubAllEnvs());

function env(values: Record<string, string>) {
  for (const key of ["OPENAI_API_KEY", "GEMINI_API_KEY", "LLM_PROVIDER"]) vi.stubEnv(key, values[key] ?? "");
}

describe("provider", () => {
  it("prefers OpenAI when both keys are set", () => {
    env({ OPENAI_API_KEY: "a", GEMINI_API_KEY: "b" });
    expect(provider()).toBe("openai");
  });
  it("falls back to Gemini, and to none", () => {
    env({ GEMINI_API_KEY: "b" });
    expect(provider()).toBe("gemini");
    env({});
    expect(provider()).toBeNull();
  });
  it("honours LLM_PROVIDER", () => {
    env({ OPENAI_API_KEY: "a", GEMINI_API_KEY: "b", LLM_PROVIDER: "gemini" });
    expect(provider()).toBe("gemini");
  });
});

describe("isLiteModel", () => {
  it("flags small fallbacks whose identity answers are not trusted", () => {
    expect(isLiteModel("gemini-3.5-flash-lite")).toBe(true);
    expect(isLiteModel("gpt-5.4-nano")).toBe(true);
    expect(isLiteModel("gpt-5.4-mini")).toBe(false);
  });
});
