import { nip19 } from "nostr-tools";

import { articleNaddr, parseArticleEvent } from "../articleParser";
import type { NostrEvent } from "@thewired/shared-types";

const PUBKEY = "a".repeat(64);

const article = (tags: string[][], over: Partial<NostrEvent> = {}): NostrEvent => ({
  id: "e1",
  pubkey: PUBKEY,
  created_at: 1700000000,
  kind: 30023,
  tags,
  content: "body",
  sig: "",
  ...over,
});

describe("parseArticleEvent", () => {
  it("parses title/summary/image/published_at", () => {
    const item = parseArticleEvent(
      article([
        ["d", "my-post"],
        ["title", "Hello"],
        ["summary", "A post"],
        ["image", "https://cdn.x/cover.jpg"],
        ["published_at", "1600000000"],
      ]),
    );
    expect(item).toMatchObject({
      dTag: "my-post",
      title: "Hello",
      summary: "A post",
      image: "https://cdn.x/cover.jpg",
      publishedAt: 1600000000,
    });
  });

  it("defaults title and falls back to created_at", () => {
    const item = parseArticleEvent(article([["d", "x"]]));
    expect(item).toMatchObject({
      title: "Untitled",
      summary: null,
      image: null,
      publishedAt: 1700000000,
    });
  });

  it("rejects wrong kinds and missing d tags", () => {
    expect(parseArticleEvent(article([["d", "x"]], { kind: 1 }))).toBeNull();
    expect(parseArticleEvent(article([["title", "no d"]]))).toBeNull();
  });

  it("drops non-https covers", () => {
    const item = parseArticleEvent(
      article([
        ["d", "x"],
        ["image", "javascript:alert(1)"],
      ]),
    );
    expect(item?.image).toBeNull();
  });
});

describe("articleNaddr", () => {
  it("round-trips through nip19 with an optional relay hint", () => {
    const item = parseArticleEvent(article([["d", "my-post"]]))!;
    const decoded = nip19.decode(articleNaddr(item, "wss://relay.x"));
    expect(decoded.type).toBe("naddr");
    expect(decoded.data).toMatchObject({
      identifier: "my-post",
      kind: 30023,
      pubkey: PUBKEY,
      relays: ["wss://relay.x"],
    });

    const bare = nip19.decode(articleNaddr(item, null));
    expect((bare.data as { relays?: string[] }).relays ?? []).toEqual([]);
  });
});
