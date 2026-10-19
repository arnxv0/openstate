import { describe, expect, it } from "vitest";
import { imageBudget, keyOrder } from "@/lib/groq";

describe("groq key rotation", () => {
  it("starts at the cursor and wraps around", () => {
    expect(keyOrder(4, 2, new Map(), 0)).toEqual([2, 3, 0, 1]);
  });

  it("skips keys resting after a rate limit, and uses them again afterwards", () => {
    const resting = new Map([[3, 1000]]);
    expect(keyOrder(4, 2, resting, 500)).toEqual([2, 0, 1]);
    expect(keyOrder(4, 2, resting, 1000)).toEqual([2, 3, 0, 1]);
  });

  it("is empty when there are no keys or all are resting", () => {
    expect(keyOrder(0, 0, new Map(), 0)).toEqual([]);
    expect(keyOrder(1, 0, new Map([[0, 10]]), 5)).toEqual([]);
  });
});

describe("imageBudget", () => {
  it("sends everything when it fits", () => {
    expect(imageBudget(Infinity, [3, 2], 6)).toEqual({ refs: [3, 2], frames: [0, 1, 2, 3, 4, 5] });
    expect(imageBudget(3, [1], 2)).toEqual({ refs: [1], frames: [0, 1] });
  });

  it("keeps the first and last frame and one reference of the first candidate", () => {
    expect(imageBudget(3, [3, 2], 6)).toEqual({ refs: [1, 0], frames: [0, 5] });
  });

  it("uses spare slots for a middle frame when there are no references", () => {
    expect(imageBudget(3, [], 6)).toEqual({ refs: [], frames: [0, 3, 5] });
    expect(imageBudget(3, [0], 7)).toEqual({ refs: [0], frames: [0, 3, 6] });
  });

  it("handles a single frame at registration", () => {
    expect(imageBudget(3, [3, 3, 3], 1)).toEqual({ refs: [1, 1, 0], frames: [0] });
  });
});
