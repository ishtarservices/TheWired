import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { resolveArticleRef } from "../useArticle";
import type { NostrEvent } from "../../../types/nostr";

const PK = "a".repeat(64);
const ID = "b".repeat(64);

function ev(over: Partial<NostrEvent>): NostrEvent {
  return {
    id: ID,
    pubkey: PK,
    kind: 30023,
    created_at: 1,
    tags: [],
    content: "",
    sig: "x",
    ...over,
  } as NostrEvent;
}

describe("resolveArticleRef — the /article/:id resolver (regression: route was dead)", () => {
  it("resolves a raw 64-char hex event id", () => {
    const r = resolveArticleRef(ID);
    expect(r).not.toBeNull();
    expect(r!.filter.ids).toEqual([ID]);
    expect(r!.match(ev({ id: ID }))).toBe(true);
    expect(r!.match(ev({ id: "c".repeat(64) }))).toBe(false);
  });

  it("uppercases-hex is normalized to lowercase", () => {
    const r = resolveArticleRef(ID.toUpperCase());
    expect(r!.filter.ids).toEqual([ID]);
  });

  it("resolves an naddr into a pinned-author addressable filter", () => {
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey: PK, identifier: "my-slug", relays: [] });
    const r = resolveArticleRef(naddr);
    expect(r).not.toBeNull();
    expect(r!.filter.kinds).toEqual([30023]);
    expect(r!.filter.authors).toEqual([PK]); // security: author pinned
    expect(r!.filter["#d"]).toEqual(["my-slug"]);
    expect(r!.match(ev({ tags: [["d", "my-slug"]] }))).toBe(true);
    // wrong d-tag must not match
    expect(r!.match(ev({ tags: [["d", "other"]] }))).toBe(false);
    // same d-tag but different author must not match (forgery guard)
    expect(r!.match(ev({ pubkey: "d".repeat(64), tags: [["d", "my-slug"]] }))).toBe(false);
  });

  it("resolves a note1 reference to an ids filter", () => {
    const note = nip19.noteEncode(ID);
    const r = resolveArticleRef(note);
    expect(r!.filter.ids).toEqual([ID]);
  });

  it("returns null for garbage / unsupported input", () => {
    expect(resolveArticleRef("")).toBeNull();
    expect(resolveArticleRef("not-an-id")).toBeNull();
    expect(resolveArticleRef("npub1xxx")).toBeNull();
  });
});
