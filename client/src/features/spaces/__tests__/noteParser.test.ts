import { describe, it, expect } from "vitest";
import { isDirectReply, isRootNote, parseThreadRef } from "../noteParser";
import type { NostrEvent } from "../../../types/nostr";

function ev(tags: string[][], kind = 1): NostrEvent {
  return {
    id: "x".repeat(64),
    pubkey: "a".repeat(64),
    created_at: 1000,
    kind,
    tags,
    content: "hi",
    sig: "0".repeat(128),
  };
}

const ROOT = "r".repeat(64);
const CHILD = "c".repeat(64);

describe("isDirectReply", () => {
  it("marked reply directly to the root (root+reply both = root id)", () => {
    const e = ev([
      ["e", ROOT, "", "root"],
      ["e", ROOT, "", "reply"],
    ]);
    expect(isDirectReply(e, ROOT)).toBe(true);
  });

  it("marked reply with only a root tag counts as a direct reply to root", () => {
    const e = ev([["e", ROOT, "", "root"]]);
    expect(isDirectReply(e, ROOT)).toBe(true);
  });

  it("marked reply to a CHILD is direct to the child, not the root", () => {
    const e = ev([
      ["e", ROOT, "", "root"],
      ["e", CHILD, "", "reply"],
    ]);
    expect(isDirectReply(e, CHILD)).toBe(true);
    // The crux of the dedup fix: a grandchild must NOT count under the root.
    expect(isDirectReply(e, ROOT)).toBe(false);
  });

  it("deprecated positional: single e-tag = direct reply to that note", () => {
    const e = ev([["e", ROOT]]);
    expect(isDirectReply(e, ROOT)).toBe(true);
  });

  it("deprecated positional: first=root last=reply → direct to the last", () => {
    const e = ev([
      ["e", ROOT],
      ["e", CHILD],
    ]);
    expect(isDirectReply(e, CHILD)).toBe(true);
    expect(isDirectReply(e, ROOT)).toBe(false);
  });

  it("a note with no e-tags is a direct reply to nobody", () => {
    const e = ev([]);
    expect(isDirectReply(e, ROOT)).toBe(false);
  });
});

describe("parseThreadRef / isRootNote (sanity)", () => {
  it("root note has null rootId", () => {
    expect(isRootNote(ev([]))).toBe(true);
    expect(parseThreadRef(ev([])).rootId).toBeNull();
  });

  it("a reply is not a root note", () => {
    expect(isRootNote(ev([["e", ROOT, "", "root"]]))).toBe(false);
  });
});
