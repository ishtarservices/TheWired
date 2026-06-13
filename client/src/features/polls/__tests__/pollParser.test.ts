import { describe, it, expect } from "vitest";
import { parsePollEvent, parseVoteEvent } from "../pollParser";
import type { NostrEvent } from "../../../types/nostr";

const PK = "a".repeat(64);

function pollEvent(tags: string[][], over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "poll-1",
    pubkey: PK,
    created_at: 1_700_000_000,
    kind: 1068,
    tags,
    content: "Pineapple on pizza?",
    sig: "0".repeat(128),
    ...over,
  };
}

describe("parsePollEvent", () => {
  it("parses options, relays, polltype and endsAt", () => {
    const poll = parsePollEvent(
      pollEvent([
        ["option", "opt1", "Yay"],
        ["option", "opt2", "Nay"],
        ["relay", "wss://relay.one"],
        ["relay", "wss://relay.two"],
        ["polltype", "multiplechoice"],
        ["endsAt", "1700086400"],
      ]),
    );
    expect(poll.question).toBe("Pineapple on pizza?");
    expect(poll.options).toEqual([
      { id: "opt1", label: "Yay" },
      { id: "opt2", label: "Nay" },
    ]);
    expect(poll.relays).toEqual(["wss://relay.one", "wss://relay.two"]);
    expect(poll.pollType).toBe("multiplechoice");
    expect(poll.endsAt).toBe(1700086400);
  });

  it("defaults to singlechoice and no end time", () => {
    const poll = parsePollEvent(pollEvent([["option", "a", "A"], ["option", "b", "B"]]));
    expect(poll.pollType).toBe("singlechoice");
    expect(poll.endsAt).toBeUndefined();
  });

  it("first occurrence wins for duplicate option ids", () => {
    const poll = parsePollEvent(
      pollEvent([
        ["option", "x", "First"],
        ["option", "x", "Second"],
        ["option", "y", "Other"],
      ]),
    );
    expect(poll.options).toEqual([
      { id: "x", label: "First" },
      { id: "y", label: "Other" },
    ]);
  });

  it("ignores malformed endsAt and non-ws relay URLs", () => {
    const poll = parsePollEvent(
      pollEvent([
        ["option", "a", "A"],
        ["endsAt", "not-a-number"],
        ["relay", "https://not-a-relay.example"],
      ]),
    );
    expect(poll.endsAt).toBeUndefined();
    expect(poll.relays).toEqual([]);
  });

  it("attaches track refs to matching options (music kind only)", () => {
    const trackPk = "b".repeat(64);
    const poll = parsePollEvent(
      pollEvent([
        ["option", "a", "Artist — Song"],
        ["option", "b", "Plain"],
        ["track", "a", `31683:${trackPk}:my-track`],
        ["track", "b", `33123:${trackPk}:an-album`], // album kind → ignored
      ]),
    );
    expect(poll.options[0].trackRef).toEqual({
      kind: 31683,
      pubkey: trackPk,
      identifier: "my-track",
    });
    expect(poll.options[1].trackRef).toBeUndefined();
  });

  it("captures h/channel space scoping", () => {
    const poll = parsePollEvent(
      pollEvent([
        ["option", "a", "A"],
        ["h", "space-1"],
        ["channel", "ch-9"],
      ]),
    );
    expect(poll.spaceId).toBe("space-1");
    expect(poll.channelId).toBe("ch-9");
  });
});

describe("parseVoteEvent", () => {
  function voteEvent(tags: string[][]): NostrEvent {
    return {
      id: "vote-1",
      pubkey: PK,
      created_at: 1_700_000_100,
      kind: 1018,
      tags,
      content: "",
      sig: "0".repeat(128),
    };
  }

  it("parses poll ref and deduped responses", () => {
    const vote = parseVoteEvent(
      voteEvent([
        ["e", "poll-id"],
        ["response", "opt1"],
        ["response", "opt2"],
        ["response", "opt1"], // dup → counted once
      ]),
    );
    expect(vote).toEqual({
      pollId: "poll-id",
      voter: PK,
      optionIds: ["opt1", "opt2"],
      createdAt: 1_700_000_100,
      eventId: "vote-1",
    });
  });

  it("returns null without an e tag", () => {
    expect(parseVoteEvent(voteEvent([["response", "opt1"]]))).toBeNull();
  });

  it("returns null without response tags", () => {
    expect(parseVoteEvent(voteEvent([["e", "poll-id"]]))).toBeNull();
  });
});
