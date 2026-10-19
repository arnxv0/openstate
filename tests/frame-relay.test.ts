import { describe, expect, it } from "vitest";
import { nextFrame, putFrame } from "@/lib/frame-relay";

const jpeg = (byte: number) => new Uint8Array(200).fill(byte);

describe("frame relay", () => {
  it("hands a waiting dashboard the next frame as soon as the phone posts it", async () => {
    const pending = nextFrame("01", 0, 1000);
    const seq = putFrame("01", jpeg(1));
    const frame = await pending;
    expect(frame?.seq).toBe(seq);
    expect(frame?.jpeg[0]).toBe(1);
  });

  it("returns the latest frame at once when the dashboard is behind", async () => {
    putFrame("02", jpeg(1));
    const seq = putFrame("02", jpeg(2));
    const frame = await nextFrame("02", seq - 1, 1000);
    expect(frame?.jpeg[0]).toBe(2);
  });

  it("waits, then gives up, when nothing new arrives", async () => {
    const seq = putFrame("02", jpeg(3));
    expect(await nextFrame("02", seq, 30)).toBeNull();
  });

  it("does not replay a stale frame from a phone that stopped", async () => {
    const seq = putFrame("01", jpeg(4), Date.now() - 10_000);
    expect(await nextFrame("01", seq - 1, 30)).toBeNull();
  });

  it("drops a frame that arrives after a newer one", async () => {
    const now = Date.now();
    const newer = putFrame("02", jpeg(8), now, now + 2000);
    expect(putFrame("02", jpeg(7), now, now + 1000)).toBe(newer);
    expect((await nextFrame("02", newer - 1, 30))?.jpeg[0]).toBe(8);
  });

  it("resyncs a dashboard whose sequence number predates a server restart", async () => {
    const seq = putFrame("01", jpeg(5));
    const frame = await nextFrame("01", seq + 500, 30);
    expect(frame?.seq).toBe(seq);
  });
});
