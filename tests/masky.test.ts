import { describe, expect, it } from "vitest";
import { matchAvatar, readyTurn, type Turn } from "@/lib/sponsors/masky";

const list = [
  { avatarId: "a1", avatarOwnerUserId: "u1", displayName: "Sol" },
  { avatarId: "a2", avatarOwnerUserId: "u1", displayName: "nova " },
  { avatarId: "a3", avatarOwnerUserId: "u1", displayName: "runner" },
  { avatarId: "a4", avatarOwnerUserId: "u2", displayName: "Someone Else" },
];

describe("matchAvatar", () => {
  it("matches the agent's name or key, ignoring case and spaces", () => {
    expect(matchAvatar("host", list, {})).toEqual({ avatarId: "a1", ownerId: "u1", displayName: "Sol" });
    expect(matchAvatar("scout", list, {})?.avatarId).toBe("a2");
    expect(matchAvatar("runner", list, {})?.avatarId).toBe("a3");
    expect(matchAvatar("eyes", list, {})).toBeNull();
  });

  it("lets MASKY_AVATARS pin an avatar, and gives up when the pinned id is not ours", () => {
    expect(matchAvatar("eyes", list, { eyes: "a4" })?.avatarId).toBe("a4");
    expect(matchAvatar("host", list, { host: "missing" })).toBeNull();
  });
});

describe("readyTurn", () => {
  const turns: Turn[] = [
    { id: "t1", role: "user" },
    { id: "t2", role: "avatar", status: "ready", audioUrl: "https://a/1.mp3" },
    { id: "t3", role: "user", audioUrl: "https://a/user.mp3" },
    { id: "t4", role: "avatar", status: "rendering", audioUrl: null, videoUrl: null },
  ];

  it("returns the newest avatar turn that has the media, skipping user turns", () => {
    expect(readyTurn(turns, "audio")?.id).toBe("t2");
    expect(readyTurn(turns, "video")).toBeNull();
    expect(readyTurn([], "audio")).toBeNull();
  });

  it("takes the newest once it is ready", () => {
    const ready = [...turns.slice(0, 3), { id: "t4", role: "avatar", audioUrl: "https://a/2.mp3" }];
    expect(readyTurn(ready, "audio")?.id).toBe("t4");
  });
});
