import { describe, it, expect } from "vitest";
import { applyPinOps, isNewerEvent, newerOf, pinnedIdsFromTags, sameTags } from "../pinList";
import type { NostrEvent } from "@/types/nostr";

const id = (c: string) => c.repeat(64);
const HINT = "wss://relay.example";

const ev = (over: Partial<NostrEvent>): NostrEvent => ({
  id: id("0"),
  pubkey: "a".repeat(64),
  created_at: 100,
  kind: 10001,
  tags: [],
  content: "",
  sig: "",
  ...over,
});

describe("pinnedIdsFromTags", () => {
  it("reads e tags in list order, deduped; ignores everything else", () => {
    expect(
      pinnedIdsFromTags([
        ["e", id("1"), "wss://x"],
        ["a", "30023:pk:slug"],
        ["e", "not-hex"],
        ["e", id("2")],
        ["e", id("1")],
      ]),
    ).toEqual([id("1"), id("2")]);
  });
});

describe("replaceable order", () => {
  it("newest created_at wins; a tie goes to the lower id", () => {
    const old = ev({ id: id("1"), created_at: 10 });
    const tieLow = ev({ id: id("2"), created_at: 20 });
    const tieHigh = ev({ id: id("9"), created_at: 20 });
    expect(isNewerEvent(tieLow, old)).toBe(true);
    expect(isNewerEvent(tieLow, tieHigh)).toBe(true);
    expect(isNewerEvent(tieHigh, tieLow)).toBe(false);
    expect(newerOf(null, old)).toBe(old);
    expect(newerOf(old, tieLow)).toBe(tieLow);
  });
});

describe("applyPinOps", () => {
  const base = [["e", id("1"), "wss://their.relay"], ["client", "x"]];

  it("appends a new pin with the hint, leaves the rest verbatim", () => {
    expect(applyPinOps(base, [{ id: id("2"), pin: true }], HINT)).toEqual([...base, ["e", id("2"), HINT]]);
  });

  it("keeps an existing pin where it is", () => {
    expect(applyPinOps(base, [{ id: id("1"), pin: true }], HINT)).toEqual(base);
  });

  it("drops every tag for an unpinned id", () => {
    expect(applyPinOps([...base, ["e", id("1")]], [{ id: id("1"), pin: false }])).toEqual([["client", "x"]]);
  });

  it("compares tag lists element-wise", () => {
    expect(sameTags(base, base.map((t) => [...t]))).toBe(true);
    expect(sameTags(base, [base[0]])).toBe(false);
  });
});
