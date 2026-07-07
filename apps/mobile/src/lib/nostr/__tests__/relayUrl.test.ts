import { isSafePeerRelayUrl, normalizeRelayUrl, parseDMRelayTags } from "../relayUrl";

describe("normalizeRelayUrl", () => {
  it("normalizes and strips trailing slash", () => {
    expect(normalizeRelayUrl("wss://Relay.Example.com/")).toBe("wss://relay.example.com");
    expect(normalizeRelayUrl("wss://relay.example.com/inbox/")).toBe(
      "wss://relay.example.com/inbox/",
    );
  });

  it("rejects non-websocket schemes and junk", () => {
    expect(normalizeRelayUrl("https://relay.example.com")).toBeNull();
    expect(normalizeRelayUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeRelayUrl("not a url")).toBeNull();
  });
});

describe("isSafePeerRelayUrl (attacker-controlled kind-10050 entries)", () => {
  it("accepts public wss relays", () => {
    expect(isSafePeerRelayUrl("wss://relay.damus.io")).toBe(true);
  });

  it("rejects plaintext ws (no loopback exemption on mobile)", () => {
    expect(isSafePeerRelayUrl("ws://relay.example.com")).toBe(false);
  });

  it("rejects loopback, private and link-local hosts", () => {
    for (const bad of [
      "wss://localhost:7777",
      "wss://127.0.0.1",
      "wss://10.0.0.5",
      "wss://192.168.1.10",
      "wss://172.16.0.1",
      "wss://169.254.1.1",
      "wss://[::1]:7777",
      "wss://relay.local",
      "wss://internal-thing.internal",
    ]) {
      expect(isSafePeerRelayUrl(bad)).toBe(false);
    }
  });
});

describe("parseDMRelayTags", () => {
  it("extracts safe relay tags, deduped, ignoring the rest", () => {
    expect(
      parseDMRelayTags([
        ["relay", "wss://inbox.example.com/"],
        ["relay", "wss://inbox.example.com"],
        ["relay", "ws://plaintext.example.com"],
        ["relay", "wss://127.0.0.1"],
        ["e", "wss://not-a-relay-tag.example.com"],
        ["relay", "https://web.example.com"],
      ]),
    ).toEqual(["wss://inbox.example.com"]);
  });
});
