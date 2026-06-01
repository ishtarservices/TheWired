import { describe, it, expect } from "vitest";
import {
  wiredRelaysDTag,
  sanitizeRelayUrl,
  isPrivateOrLoopbackHost,
  buildRelaySetEvent,
  parseRelaySetEvent,
  resolveRelaySet,
} from "../relaySet";
import type { Space } from "../../../types/space";
import type { NostrEvent } from "../../../types/nostr";

const baseSpace: Space = {
  id: "abc123",
  hostRelay: "wss://relay.example.com",
  name: "Test",
  isPrivate: false,
  adminPubkeys: ["admin1"],
  memberPubkeys: ["admin1"],
  feedPubkeys: [],
  mode: "read-write",
  creatorPubkey: "creator1",
  createdAt: 0,
  spaceType: "nip29-native",
  relayPubkey: "relaykey",
};

function ev(pubkey: string, tags: string[][]): NostrEvent {
  return {
    id: "e",
    pubkey,
    created_at: 1,
    kind: 30078,
    tags,
    content: "",
    sig: "s",
  };
}

describe("sanitizeRelayUrl", () => {
  it("accepts ws/wss and strips trailing slash", () => {
    expect(sanitizeRelayUrl("wss://r.example.com/")).toBe("wss://r.example.com");
    expect(sanitizeRelayUrl("  ws://127.0.0.1:7777 ")).toBe("ws://127.0.0.1:7777");
  });
  it("rejects non-ws schemes and junk", () => {
    expect(sanitizeRelayUrl("https://r.example.com")).toBeNull();
    expect(sanitizeRelayUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeRelayUrl("")).toBeNull();
    expect(sanitizeRelayUrl(42)).toBeNull();
    expect(sanitizeRelayUrl("wss://" + "x".repeat(600))).toBeNull();
  });
});

describe("buildRelaySetEvent", () => {
  it("emits authority + deduped mirrors with the right d-tag", () => {
    const e = buildRelaySetEvent("admin1", "abc123", "wss://auth.example.com", [
      "wss://m1.example.com",
      "wss://m1.example.com", // dup
      "wss://auth.example.com", // == authority, drop
      "ftp://bad", // invalid
    ]);
    expect(e.kind).toBe(30078);
    expect(e.tags.find((t) => t[0] === "d")?.[1]).toBe(wiredRelaysDTag("abc123"));
    const relays = e.tags.filter((t) => t[0] === "relay");
    expect(relays).toEqual([
      ["relay", "wss://auth.example.com", "authority"],
      ["relay", "wss://m1.example.com", "mirror"],
    ]);
  });
});

describe("parseRelaySetEvent", () => {
  it("parses authority + mirrors from an authorized author", () => {
    const e = ev("admin1", [
      ["d", wiredRelaysDTag("abc123")],
      ["relay", "wss://auth.example.com", "authority"],
      ["relay", "wss://m1.example.com", "mirror"],
      ["relay", "wss://m2.example.com"], // no marker → mirror
    ]);
    expect(parseRelaySetEvent(e, baseSpace)).toEqual({
      authority: "wss://auth.example.com",
      mirrors: ["wss://m1.example.com", "wss://m2.example.com"],
    });
  });

  it("rejects an unauthorized author (anti-forgery)", () => {
    const e = ev("attacker", [
      ["d", wiredRelaysDTag("abc123")],
      ["relay", "wss://evil.example.com", "mirror"],
    ]);
    expect(parseRelaySetEvent(e, baseSpace)).toBeNull();
  });

  it("accepts the relay's own signing key as author", () => {
    const e = ev("relaykey", [
      ["d", wiredRelaysDTag("abc123")],
      ["relay", "wss://auth.example.com", "authority"],
    ]);
    expect(parseRelaySetEvent(e, baseSpace)?.authority).toBe("wss://auth.example.com");
  });

  it("ignores a different space's relay set", () => {
    const e = ev("admin1", [
      ["d", wiredRelaysDTag("OTHER")],
      ["relay", "wss://x.example.com", "mirror"],
    ]);
    expect(parseRelaySetEvent(e, baseSpace)).toBeNull();
  });

  it("drops invalid relay URLs", () => {
    const e = ev("admin1", [
      ["d", wiredRelaysDTag("abc123")],
      ["relay", "https://nope.example.com", "mirror"],
      ["relay", "wss://ok.example.com", "mirror"],
    ]);
    expect(parseRelaySetEvent(e, baseSpace)).toEqual({
      authority: undefined,
      mirrors: ["wss://ok.example.com"],
    });
  });
});

describe("isPrivateOrLoopbackHost (SSRF guard)", () => {
  it("flags loopback / private / link-local / CGNAT / .local", () => {
    for (const h of [
      "localhost",
      "wss://localhost:7777",
      "127.0.0.1",
      "ws://127.0.0.1:7777",
      "10.0.0.5",
      "192.168.1.10",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "::1",
      "wss://[::1]:7777",
      "fe80::1",
      "myrelay.local",
    ]) {
      expect(isPrivateOrLoopbackHost(h)).toBe(true);
    }
  });

  it("allows public hosts", () => {
    for (const h of [
      "groups.0xchat.com",
      "wss://relay.thewired.app",
      "1.1.1.1",
      "8.8.8.8",
      "172.15.0.1", // just outside RFC1918
      "172.32.0.1",
      "foo.trycloudflare.com",
    ]) {
      expect(isPrivateOrLoopbackHost(h)).toBe(false);
    }
  });
});

describe("parseRelaySetEvent drops auto-dialed private addresses", () => {
  it("filters loopback/private mirrors learned from an overlay", () => {
    const e = ev("admin1", [
      ["d", wiredRelaysDTag("abc123")],
      ["relay", "wss://public.example.com", "mirror"],
      ["relay", "ws://127.0.0.1:7777", "mirror"], // SSRF attempt
      ["relay", "ws://192.168.1.5", "mirror"], // LAN probe
      ["relay", "wss://also-public.example.com", "authority"],
    ]);
    expect(parseRelaySetEvent(e, baseSpace)).toEqual({
      authority: "wss://also-public.example.com",
      mirrors: ["wss://public.example.com"],
    });
  });
});

describe("resolveRelaySet", () => {
  it("unions hostRelay + mirrors, deduped, authority first", () => {
    expect(
      resolveRelaySet({
        hostRelay: "wss://auth.example.com",
        relayUrls: ["wss://m1.example.com", "wss://auth.example.com", "wss://m2.example.com"],
      }),
    ).toEqual(["wss://auth.example.com", "wss://m1.example.com", "wss://m2.example.com"]);
  });
  it("handles no mirrors", () => {
    expect(resolveRelaySet({ hostRelay: "wss://only.example.com" })).toEqual([
      "wss://only.example.com",
    ]);
  });
});
