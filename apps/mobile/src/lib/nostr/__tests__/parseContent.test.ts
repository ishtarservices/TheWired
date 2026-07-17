import { nip19 } from "nostr-tools";

import { parseContent, type ContentSegment } from "../parseContent";

const PUBKEY = "a".repeat(64);
const EVENT_ID = "b".repeat(64);

const only = <T extends ContentSegment["type"]>(segments: ContentSegment[], type: T) =>
  segments.filter((s): s is Extract<ContentSegment, { type: T }> => s.type === type);

describe("parseContent", () => {
  it("plain text stays a single text segment", () => {
    expect(parseContent("just words, no entities")).toEqual([
      { type: "text", text: "just words, no entities" },
    ]);
  });

  it("parses a nostr:npub mention mid-text", () => {
    const npub = nip19.npubEncode(PUBKEY);
    const segments = parseContent(`hello nostr:${npub} welcome!`);
    expect(segments.map((s) => s.type)).toEqual(["text", "mention", "text"]);
    expect(only(segments, "mention")[0].pubkey).toBe(PUBKEY);
  });

  it("parses nostr:nevent and sanitizes attacker-controlled relay hints", () => {
    const nevent = nip19.neventEncode({
      id: EVENT_ID,
      author: PUBKEY,
      relays: ["wss://relay.damus.io", "ws://localhost:7777", "wss://192.168.1.10"],
    });
    const segments = parseContent(`look: nostr:${nevent}`);
    const [ref] = only(segments, "event-ref");
    expect(ref.id).toBe(EVENT_ID);
    expect(ref.author).toBe(PUBKEY);
    expect(ref.relays).toEqual(["wss://relay.damus.io"]);
  });

  it("parses nostr:note into an event-ref", () => {
    const note = nip19.noteEncode(EVENT_ID);
    const [ref] = only(parseContent(`nostr:${note}`), "event-ref");
    expect(ref.id).toBe(EVENT_ID);
  });

  it("parses nostr:naddr into an addr-ref", () => {
    const naddr = nip19.naddrEncode({
      identifier: "my-article",
      pubkey: PUBKEY,
      kind: 30023,
    });
    const [ref] = only(parseContent(`read nostr:${naddr}`), "addr-ref");
    expect(ref).toMatchObject({ identifier: "my-article", pubkey: PUBKEY, kind: 30023 });
  });

  it("parses nostr:nprofile with only safe hints surviving", () => {
    const nprofile = nip19.nprofileEncode({
      pubkey: PUBKEY,
      relays: ["ws://10.0.0.1:7777", "wss://nos.lol"],
    });
    const [mention] = only(parseContent(`nostr:${nprofile}`), "mention");
    expect(mention.pubkey).toBe(PUBKEY);
    expect(mention.relays).toEqual(["wss://nos.lol"]);
  });

  it("catches bare nip19 entities without the nostr: prefix", () => {
    const nevent = nip19.neventEncode({ id: EVENT_ID });
    const npub = nip19.npubEncode(PUBKEY);
    const segments = parseContent(`quoting ${nevent} by ${npub}`);
    expect(only(segments, "event-ref")[0].id).toBe(EVENT_ID);
    expect(only(segments, "mention")[0].pubkey).toBe(PUBKEY);
  });

  it("leaves invalid bech32-looking strings as text", () => {
    const bogus = `npub1${"q".repeat(30)}`;
    const segments = parseContent(`not real: ${bogus}`);
    expect(segments).toEqual([{ type: "text", text: `not real: ${bogus}` }]);
  });

  it("classifies image URLs as image segments and others as url", () => {
    const segments = parseContent(
      "pic https://cdn.example.com/a.png and site https://example.com/page",
    );
    expect(only(segments, "image")[0].url).toBe("https://cdn.example.com/a.png");
    expect(only(segments, "url")[0].url).toBe("https://example.com/page");
  });

  it("extracts hashtags", () => {
    const segments = parseContent("gm #nostr");
    expect(only(segments, "hashtag")[0].value).toBe("nostr");
  });
});
