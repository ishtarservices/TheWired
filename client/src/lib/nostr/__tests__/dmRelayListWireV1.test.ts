import { describe, it, expect } from "vitest";
import { parseDMRelayList } from "../dmRelayList";
import { APP_RELAY } from "../constants";

const ev = (relays: string[]) => ({
  id: "1".repeat(64), pubkey: "a".repeat(64), created_at: 1, kind: 10050,
  tags: relays.map((r) => ["relay", r]), content: "", sig: "0".repeat(128),
});

describe("parseDMRelayList — SSRF guard with the platform-relay exemption", () => {
  it("drops loopback/private hosts from a peer's list except the app's own configured relay", () => {
    const out = parseDMRelayList(ev([APP_RELAY, "ws://127.0.0.1:9999", "ws://10.0.0.5:7777", "wss://relay.damus.io"]));
    expect(out).toContain("wss://relay.damus.io");
    expect(out).not.toContain("ws://127.0.0.1:9999");
    expect(out).not.toContain("ws://10.0.0.5:7777");
    // APP_RELAY is loopback in dev/test builds and must survive; in prod it's a public wss host.
    expect(out.some((u) => u.replace(/\/$/, "") === APP_RELAY.replace(/\/$/, ""))).toBe(true);
  });
});
