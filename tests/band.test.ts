import { describe, expect, it } from "vitest";
import {
  buildMessage,
  humanParticipant,
  matchParticipant,
  normaliseParticipants,
  parseAgents,
  type Participant,
} from "@/lib/sponsors/band";

const room: Participant[] = [
  { id: "p-mira", name: "Mira", handle: "mira", type: "agent" },
  { id: "p-sol", name: "sol", handle: "openstate-sol", type: "agent" },
  { id: "p-nova", name: "Research Nova", handle: "scout", type: "agent" },
  { id: "p-arnav", name: "Arnav", handle: "arnav", type: "user" },
];

describe("parseAgents", () => {
  it("reads key=uuid:apiKey pairs and drops anything malformed or unknown", () => {
    expect(parseAgents("gm=u1:k1, host=u2:k2,bogus=u3:k3,eyes=nocolon,=u4:k4")).toEqual([
      { key: "gm", agentId: "u1", apiKey: "k1" },
      { key: "host", agentId: "u2", apiKey: "k2" },
    ]);
    expect(parseAgents(undefined)).toEqual([]);
  });

  it("keeps colons inside the api key", () => {
    expect(parseAgents("scout=u1:ab:cd")).toEqual([{ key: "scout", agentId: "u1", apiKey: "ab:cd" }]);
  });
});

describe("matchParticipant", () => {
  it("matches by display name, roster key or handle, ignoring case", () => {
    expect(matchParticipant(room, "gm")?.id).toBe("p-mira");
    expect(matchParticipant(room, "host")?.id).toBe("p-sol");
    expect(matchParticipant(room, "scout")?.id).toBe("p-nova");
    expect(matchParticipant(room, "runner")).toBeNull();
  });

  it("finds the human", () => {
    expect(humanParticipant(room)?.id).toBe("p-arnav");
    expect(humanParticipant(room.slice(0, 3))).toBeNull();
  });
});

describe("buildMessage", () => {
  it("prefixes @names and carries the mentions BAND requires", () => {
    expect(buildMessage("please count the table", [room[0], room[2]])).toEqual({
      message: {
        content: "@Mira @Research Nova please count the table",
        mentions: [
          { id: "p-mira", name: "Mira", handle: "mira" },
          { id: "p-nova", name: "Research Nova", handle: "scout" },
        ],
      },
    });
    expect(buildMessage("hi", []).message).toEqual({ content: "hi", mentions: [] });
  });
});

describe("normaliseParticipants", () => {
  it("reads a bare array, a participants envelope and nested identities", () => {
    expect(normaliseParticipants([{ id: "1", name: "A", handle: "a", type: "agent" }])).toEqual([
      { id: "1", name: "A", handle: "a", type: "agent" },
    ]);
    expect(
      normaliseParticipants({
        participants: [
          { participant_id: "2", user: { name: "Bea", handle: "bea" } },
          { id: "3", agent: { id: "a3", name: "Cy" } },
          { id: "", name: "nameless" },
        ],
      }),
    ).toEqual([
      { id: "2", name: "Bea", handle: "bea", type: "user" },
      { id: "3", name: "Cy", handle: "Cy", type: "agent" },
    ]);
    expect(normaliseParticipants("nonsense")).toEqual([]);
  });
});
