import { beforeEach, describe, expect, it } from "vitest";
import {
  episodeFinished,
  episodesSettled,
  episodeStarted,
  expectEpisode,
  outstanding,
  resetEpisodeQueue,
} from "@/lib/episode-queue";

beforeEach(resetEpisodeQueue);

describe("episode queue", () => {
  it("does not hold a question when nothing is outstanding", async () => {
    expect(await episodesSettled(1000)).toBeLessThan(20);
  });

  it("holds a question until the episode being read is finished", async () => {
    episodeStarted("02");
    setTimeout(episodeFinished, 60);
    const waited = await episodesSettled(2000);
    expect(waited).toBeGreaterThanOrEqual(50);
    expect(waited).toBeLessThan(500);
  });

  it("waits for an episode the dashboard announced, then for its result", async () => {
    expectEpisode("02");
    setTimeout(() => episodeStarted("02"), 40);
    setTimeout(episodeFinished, 100);
    const waited = await episodesSettled(2000);
    expect(waited).toBeGreaterThanOrEqual(90);
    expect(outstanding()).toEqual({ inFlight: 0, expected: 0 });
  });

  it("gives up after the timeout rather than hanging the answer", async () => {
    episodeStarted("01");
    const waited = await episodesSettled(80);
    expect(waited).toBeGreaterThanOrEqual(80);
    expect(waited).toBeLessThan(400);
  });

  it("forgets an announced episode that never arrives", () => {
    expectEpisode("01", Date.now() - 10_000);
    expect(outstanding()).toEqual({ inFlight: 0, expected: 0 });
  });
});
