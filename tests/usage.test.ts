import { describe, expect, it } from "vitest";
import { addUsage, costUsd } from "@/lib/usage";

describe("usage cost", () => {
  it("prices tokens per million by model", () => {
    expect(costUsd("gpt-5.4-mini", 1_000_000, 0)).toBeCloseTo(0.75);
    expect(costUsd("gpt-5.4-mini", 0, 1_000_000)).toBeCloseTo(4.5);
    expect(costUsd("gpt-4.1-mini", 1_000_000, 1_000_000)).toBeCloseTo(2);
    expect(costUsd("gemini-2.5-flash", 5_000_000, 5_000_000)).toBe(0);
  });

  it("uses the default price for a model it does not know", () => {
    expect(costUsd("some-new-model", 2_000_000, 0)).toBeCloseTo(1.5);
  });

  it("adds calls, tokens and cost across models", () => {
    const total = addUsage([
      { model: "gpt-5.4-mini", calls: 10, input: 60_000, output: 4_000 },
      { model: "gpt-4.1-mini", calls: 2, input: 10_000, output: 1_000 },
    ]);
    expect(total.calls).toBe(12);
    expect(total.input).toBe(70_000);
    expect(total.usd).toBeCloseTo(0.045 + 0.018 + 0.004 + 0.0016);
  });
});
