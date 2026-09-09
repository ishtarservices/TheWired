import { describe, it, expect } from "vitest";
import type { DiscoverSpace } from "@/lib/api/discover";
import {
  formatSats,
  rankSpaces,
  rankTracks,
  sortDisclosure,
  spaceSignalLabel,
  trackSignalLabel,
  zapCountFor,
  type RankableTrack,
} from "../ranking";

const NOW_MS = 1_800_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);
const DAY_MS = 86_400_000;

export function space(over: Partial<DiscoverSpace> = {}): DiscoverSpace {
  return {
    id: "s1",
    name: "Space",
    about: null,
    picture: null,
    category: null,
    hostRelay: null,
    spaceMode: "platform",
    memberCount: 0,
    activeMembers24h: 0,
    featured: false,
    listed: true,
    tags: [],
    mode: "read-write",
    language: null,
    messagesLast24h: 0,
    discoveryScore: 0,
    zapCount24h: 0,
    zapSats24h: 0,
    externalOrigin: false,
    creatorPubkey: null,
    listedAt: null,
    createdAt: null,
    ...over,
  };
}

function track(over: { id: string; createdAt: number }): RankableTrack & { id: string } {
  return { id: over.id, addressableId: `31683:pk:${over.id}`, createdAt: over.createdAt };
}

describe("rankSpaces", () => {
  it("zapped mode orders by sats, then count, then score", () => {
    const rich = space({ id: "rich", zapCount24h: 2, zapSats24h: 9000 });
    const many = space({ id: "many", zapCount24h: 40, zapSats24h: 100 });
    const none = space({ id: "none", discoveryScore: 500 });
    expect(rankSpaces([none, many, rich], "zapped").map((s) => s.id)).toEqual([
      "rich",
      "many",
      "none",
    ]);
  });

  it("active mode weights live members above raw message volume", () => {
    const chatty = space({ id: "chatty", messagesLast24h: 20 });
    const alive = space({ id: "alive", activeMembers24h: 5 });
    expect(rankSpaces([chatty, alive], "active").map((s) => s.id)).toEqual(["alive", "chatty"]);
  });

  it("new mode orders by listedAt, falling back to createdAt", () => {
    const old = space({ id: "old", listedAt: NOW_MS - 30 * DAY_MS });
    const fresh = space({ id: "fresh", listedAt: NOW_MS - DAY_MS });
    const noListed = space({ id: "createdOnly", createdAt: NOW_MS - 2 * DAY_MS });
    expect(rankSpaces([old, noListed, fresh], "new").map((s) => s.id)).toEqual([
      "fresh",
      "createdOnly",
      "old",
    ]);
  });

  it("big mode orders by member count", () => {
    const small = space({ id: "small", memberCount: 3 });
    const large = space({ id: "large", memberCount: 300 });
    expect(rankSpaces([small, large], "big").map((s) => s.id)).toEqual(["large", "small"]);
  });

  it("is stable for equal scores so refetches do not reshuffle rows", () => {
    const a = space({ id: "aaa" });
    const b = space({ id: "bbb" });
    expect(rankSpaces([b, a], "active").map((s) => s.id)).toEqual(["aaa", "bbb"]);
    expect(rankSpaces([a, b], "active").map((s) => s.id)).toEqual(["aaa", "bbb"]);
  });

  it("does not mutate the input array", () => {
    const input = [space({ id: "b", memberCount: 1 }), space({ id: "a", memberCount: 9 })];
    rankSpaces(input, "big");
    expect(input.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("spaceSignalLabel", () => {
  it("leads with zaps — the least gameable signal we have", () => {
    expect(
      spaceSignalLabel(space({ zapCount24h: 18, zapSats24h: 12387, activeMembers24h: 4 }), NOW_MS),
    ).toBe("18 zaps · 12.4k sats today");
  });

  it("is singular-aware and omits sats when there are none", () => {
    expect(spaceSignalLabel(space({ zapCount24h: 1, zapSats24h: 0 }), NOW_MS)).toBe("1 zap today");
  });

  it("leads with active members", () => {
    expect(spaceSignalLabel(space({ activeMembers24h: 12, messagesLast24h: 3 }), NOW_MS)).toBe(
      "12 active today",
    );
  });

  it("falls back to message volume, singular-aware", () => {
    expect(spaceSignalLabel(space({ messagesLast24h: 1 }), NOW_MS)).toBe("1 post today");
    expect(spaceSignalLabel(space({ messagesLast24h: 4 }), NOW_MS)).toBe("4 posts today");
  });

  it("calls out a recent listing when there is no activity", () => {
    expect(spaceSignalLabel(space({ listedAt: NOW_MS - 2 * DAY_MS }), NOW_MS)).toBe("new this week");
    expect(spaceSignalLabel(space({ listedAt: NOW_MS - 40 * DAY_MS }), NOW_MS)).toBeNull();
  });

  it("says nothing rather than repeating what the row already shows", () => {
    // The row renders member count and category itself; echoing them as a
    // "why" would dress duplication up as a reason.
    expect(spaceSignalLabel(space({ memberCount: 8 }), NOW_MS)).toBeNull();
    expect(spaceSignalLabel(space({ category: "nostr" }), NOW_MS)).toBeNull();
    expect(spaceSignalLabel(space(), NOW_MS)).toBeNull();
  });

  it("never claims curation as a rank reason", () => {
    // `featured` is not an input to rankSpaces, so the why-line must not
    // dress it up as one.
    expect(spaceSignalLabel(space({ featured: true }), NOW_MS)).toBeNull();
  });
});

describe("rankTracks", () => {
  it("orders by recency when there are no zaps", () => {
    const older = track({ id: "older", createdAt: NOW_S - 10 * 86_400 });
    const newer = track({ id: "newer", createdAt: NOW_S - 3600 });
    expect(rankTracks([older, newer], {}, NOW_MS).map((t) => t.id)).toEqual(["newer", "older"]);
  });

  it("lets a well-zapped older track outrank a fresh unzapped one", () => {
    const zapped = track({ id: "zapped", createdAt: NOW_S - 10 * 86_400 });
    const fresh = track({ id: "fresh", createdAt: NOW_S - 3600 });
    const zaps = { [zapped.addressableId]: { msat: 50_000, count: 30 } };
    expect(rankTracks([fresh, zapped], zaps, NOW_MS).map((t) => t.id)).toEqual(["zapped", "fresh"]);
  });

  it("damps zaps so one big count cannot dominate forever", () => {
    // log2(1+1)=1 vs log2(1+3)=2 — 3x the zaps is 2x the lift, not 3x.
    const one = track({ id: "one", createdAt: NOW_S });
    const three = track({ id: "three", createdAt: NOW_S });
    const zaps = {
      [one.addressableId]: { msat: 1, count: 1 },
      [three.addressableId]: { msat: 1, count: 3 },
    };
    expect(rankTracks([one, three], zaps, NOW_MS).map((t) => t.id)).toEqual(["three", "one"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      track({ id: "a", createdAt: NOW_S - 86_400 }),
      track({ id: "b", createdAt: NOW_S }),
    ];
    rankTracks(input, {}, NOW_MS);
    expect(input.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("trackSignalLabel", () => {
  it("omits the zap clause entirely when the aggregate is cold", () => {
    const item = track({ id: "t", createdAt: NOW_S - 2 * 86_400 });
    expect(trackSignalLabel(item, {}, NOW_MS)).toBe("2d");
  });

  it("leads with zaps when we actually have them", () => {
    const item = track({ id: "t", createdAt: NOW_S - 2 * 86_400 });
    const zaps = { [item.addressableId]: { msat: 1000, count: 9 } };
    expect(trackSignalLabel(item, zaps, NOW_MS)).toBe("9 zaps · 2d");
  });

  it("is singular-aware", () => {
    const item = track({ id: "t", createdAt: NOW_S - 3600 });
    const zaps = { [item.addressableId]: { msat: 1000, count: 1 } };
    expect(trackSignalLabel(item, zaps, NOW_MS)).toBe("1 zap · 1h");
  });

  it("never prints a play count", () => {
    const item = track({ id: "t", createdAt: NOW_S - 60 });
    expect(trackSignalLabel(item, {}, NOW_MS)).not.toMatch(/play/i);
  });
});

describe("zapCountFor", () => {
  it("reads by addressable coordinate and defaults to zero", () => {
    const item = track({ id: "t", createdAt: NOW_S });
    expect(zapCountFor(item, {})).toBe(0);
    expect(zapCountFor(item, { [item.addressableId]: { msat: 1, count: 4 } })).toBe(4);
    // An event-id key must NOT be mistaken for a coordinate.
    expect(zapCountFor(item, { [item.id]: { msat: 1, count: 4 } })).toBe(0);
  });
});

describe("sortDisclosure", () => {
  it("says nothing when the requested sort delivered", () => {
    expect(sortDisclosure("trending", "trending")).toBeNull();
    expect(sortDisclosure("recent", "recent")).toBeNull();
  });

  it("explains the trending→recent fallback in plain words", () => {
    expect(sortDisclosure("trending", "recent")).toBe(
      "Recent — not enough signal for trending yet",
    );
  });

  it("never lets recency masquerade as trending", () => {
    const disclosure = sortDisclosure("trending", "recent");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.toLowerCase()).toContain("recent");
  });

  it("has a generic form for other mismatches", () => {
    expect(sortDisclosure("active", "new")).toBe("New — active unavailable");
  });
});

describe("formatSats", () => {
  it("keeps the mono line to one row", () => {
    expect(formatSats(21)).toBe("21 sats");
    expect(formatSats(999)).toBe("999 sats");
    expect(formatSats(12387)).toBe("12.4k sats");
    expect(formatSats(120000)).toBe("120k sats");
    expect(formatSats(2_400_000)).toBe("2.4M sats");
  });
});
