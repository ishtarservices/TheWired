import { describe, it, expect } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import { matchesMutedWord, isEventVisibleInFeed } from "../feedVisibility";

function note(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "id",
    pubkey: "pk",
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  };
}

describe("matchesMutedWord", () => {
  it("returns false for an empty word list", () => {
    expect(matchesMutedWord("anything at all", [])).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(matchesMutedWord("I love Bitcoin maximalism", ["bitcoin"])).toBe(true);
    expect(matchesMutedWord("BITCOIN", ["bitcoin"])).toBe(true);
  });

  it("matches substrings (documented semantics — no word boundaries)", () => {
    expect(matchesMutedWord("catastrophe", ["cat"])).toBe(true);
  });

  it("matches multi-word phrases", () => {
    expect(matchesMutedWord("the price went up today", ["price went up"])).toBe(true);
    expect(matchesMutedWord("the price fell", ["price went up"])).toBe(false);
  });

  it("returns false when no word matches", () => {
    expect(matchesMutedWord("hello world", ["bitcoin", "spam"])).toBe(false);
  });
});

describe("isEventVisibleInFeed", () => {
  const none = new Set<string>();

  it("passes a clean event", () => {
    expect(isEventVisibleInFeed(note(), none, none, [])).toBe(true);
  });

  it("drops events from muted pubkeys", () => {
    expect(
      isEventVisibleInFeed(note({ pubkey: "bad" }), new Set(["bad"]), none, []),
    ).toBe(false);
  });

  it("drops events from locally hidden pubkeys", () => {
    expect(
      isEventVisibleInFeed(note({ pubkey: "noisy" }), none, new Set(["noisy"]), []),
    ).toBe(false);
  });

  it("drops events whose content matches a muted word", () => {
    expect(
      isEventVisibleInFeed(note({ content: "Big SPAM energy" }), none, none, ["spam"]),
    ).toBe(false);
  });
});
