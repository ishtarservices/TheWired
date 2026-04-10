import { describe, it, expect } from "vitest";
import { parseRelayList, normalizeRelayUrl } from "../nip65";
import type { NostrEvent } from "@/types/nostr";

function makeRelayListEvent(tags: string[][]): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1000000,
    kind: 10002,
    tags,
    content: "",
    sig: "test-sig",
  };
}

// ─── normalizeRelayUrl ───────────────────────────────────

describe("normalizeRelayUrl", () => {
  it("normalizes a valid wss:// URL", () => {
    expect(normalizeRelayUrl("wss://relay.damus.io")).toBe(
      "wss://relay.damus.io",
    );
  });

  it("normalizes a valid ws:// URL", () => {
    expect(normalizeRelayUrl("ws://localhost:7777")).toBe(
      "ws://localhost:7777",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeRelayUrl("wss://relay.damus.io/")).toBe(
      "wss://relay.damus.io",
    );
  });

  it("rejects non-websocket protocols", () => {
    expect(normalizeRelayUrl("https://relay.damus.io")).toBeNull();
    expect(normalizeRelayUrl("http://relay.com")).toBeNull();
    expect(normalizeRelayUrl("ftp://relay.com")).toBeNull();
  });

  it("rejects invalid URLs", () => {
    expect(normalizeRelayUrl("not a url")).toBeNull();
    expect(normalizeRelayUrl("")).toBeNull();
  });
});

// ─── parseRelayList ──────────────────────────────────────

describe("parseRelayList", () => {
  it("parses r-tags with read+write default mode", () => {
    const event = makeRelayListEvent([["r", "wss://relay1.com"]]);
    const entries = parseRelayList(event);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      url: "wss://relay1.com",
      mode: "read+write",
    });
  });

  it("parses read-only entries", () => {
    const event = makeRelayListEvent([["r", "wss://relay1.com", "read"]]);
    const entries = parseRelayList(event);
    expect(entries[0].mode).toBe("read");
  });

  it("parses write-only entries", () => {
    const event = makeRelayListEvent([["r", "wss://relay1.com", "write"]]);
    const entries = parseRelayList(event);
    expect(entries[0].mode).toBe("write");
  });

  it("parses multiple relay entries", () => {
    const event = makeRelayListEvent([
      ["r", "wss://relay1.com"],
      ["r", "wss://relay2.com", "read"],
      ["r", "wss://relay3.com", "write"],
    ]);
    const entries = parseRelayList(event);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.mode)).toEqual(["read+write", "read", "write"]);
  });

  it("skips invalid URLs", () => {
    const event = makeRelayListEvent([
      ["r", "wss://good.com"],
      ["r", "https://bad.com"],
      ["r", "not a url"],
    ]);
    const entries = parseRelayList(event);
    expect(entries).toHaveLength(1);
    expect(entries[0].url).toBe("wss://good.com");
  });

  it("skips non-r tags", () => {
    const event = makeRelayListEvent([
      ["r", "wss://relay.com"],
      ["p", "some-pubkey"],
      ["e", "some-event"],
    ]);
    const entries = parseRelayList(event);
    expect(entries).toHaveLength(1);
  });

  it("skips r-tags without a URL", () => {
    const event = makeRelayListEvent([["r"]]);
    const entries = parseRelayList(event);
    expect(entries).toHaveLength(0);
  });

  it("returns empty for non-kind:10002 events", () => {
    const event = {
      ...makeRelayListEvent([["r", "wss://relay.com"]]),
      kind: 1,
    };
    const entries = parseRelayList(event);
    expect(entries).toHaveLength(0);
  });

  it("normalizes relay URLs (strips trailing slash)", () => {
    const event = makeRelayListEvent([["r", "wss://relay.com/"]]);
    const entries = parseRelayList(event);
    expect(entries[0].url).toBe("wss://relay.com");
  });
});
