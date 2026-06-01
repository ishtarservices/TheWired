import { describe, it, expect } from "vitest";
import {
  roomKeyFromParticipants,
  buildGroupRumor,
  participantsOf,
  isGroupDM,
  roomIdOf,
  subjectOf,
} from "../nip17Room";

describe("roomKeyFromParticipants", () => {
  it("is order-independent and de-duplicated", () => {
    expect(roomKeyFromParticipants(["c", "a", "b", "a"])).toBe("a,b,c");
    expect(roomKeyFromParticipants(["a", "b", "c"])).toBe(
      roomKeyFromParticipants(["c", "b", "a"]),
    );
  });
});

describe("buildGroupRumor", () => {
  it("p-tags every participant except the sender, with subject + room id", async () => {
    const rumor = await buildGroupRumor("self", ["self", "a", "b", "c"], "hi all", {
      subject: "Project X",
      roomId: "room-42",
    });
    expect(rumor.kind).toBe(14);
    expect(rumor.pubkey).toBe("self");
    expect(rumor.content).toBe("hi all");

    const pTags = rumor.tags.filter((t) => t[0] === "p").map((t) => t[1]).sort();
    expect(pTags).toEqual(["a", "b", "c"]);
    expect(rumor.tags).toContainEqual(["g", "room-42"]);
    expect(rumor.tags).toContainEqual(["subject", "Project X"]);
    expect(rumor.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a rumor with no other participants", async () => {
    await expect(buildGroupRumor("self", ["self"], "x")).rejects.toThrow();
  });
});

describe("participantsOf / isGroupDM", () => {
  const view = (sender: string, ps: string[]) => ({
    sender,
    tags: ps.map((p) => ["p", p]),
  });

  it("unions sender with p-tags, deduped", () => {
    expect(participantsOf(view("self", ["a", "b", "self"])).sort()).toEqual([
      "a",
      "b",
      "self",
    ]);
  });

  it("treats 3+ participants as a group, 2 as a 1:1", () => {
    expect(isGroupDM(view("self", ["a", "b"]))).toBe(true); // self,a,b
    expect(isGroupDM(view("self", ["a"]))).toBe(false); // self,a
  });
});

describe("roomIdOf / subjectOf", () => {
  it("prefers an explicit g tag, else derives from participants", () => {
    expect(
      roomIdOf({ sender: "self", tags: [["p", "a"], ["p", "b"], ["g", "room-42"]] }),
    ).toBe("room-42");
    expect(roomIdOf({ sender: "self", tags: [["p", "a"], ["p", "b"]] })).toBe(
      roomKeyFromParticipants(["self", "a", "b"]),
    );
  });

  it("reads the subject tag", () => {
    expect(subjectOf({ sender: "s", tags: [["subject", "Hi"]] })).toBe("Hi");
    expect(subjectOf({ sender: "s", tags: [] })).toBeUndefined();
  });
});
