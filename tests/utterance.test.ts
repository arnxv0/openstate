import { describe, expect, it } from "vitest";
import { isAboutTheView, isQuestion } from "@/lib/utterance";

describe("isQuestion", () => {
  it("treats questions as questions", () => {
    expect(isQuestion("how many coke cans are left on the table")).toBe(true);
    expect(isQuestion("who took the last one")).toBe(true);
    expect(isQuestion("what is in the fridge")).toBe(true);
  });

  it("spots remember, register and privacy requests", () => {
    expect(isQuestion("remember this")).toBe(false);
    expect(isQuestion("register this fridge")).toBe(false);
    expect(isQuestion("please don't record that")).toBe(false);
    expect(isQuestion("this is the garage fridge")).toBe(false);
    expect(isQuestion("forget what I said")).toBe(false);
  });
});

describe("isAboutTheView", () => {
  it("is true when only the photo can answer", () => {
    expect(isAboutTheView("what am I looking at")).toBe(true);
    expect(isAboutTheView("what is this")).toBe(true);
    expect(isAboutTheView("how many cans do you see")).toBe(true);
    expect(isAboutTheView("where am I")).toBe(true);
    expect(isAboutTheView("what place is this")).toBe(true);
  });

  it("is false for questions about stored state", () => {
    expect(isAboutTheView("how many coke cans are left on the table")).toBe(false);
    expect(isAboutTheView("what should I buy")).toBe(false);
  });
});
