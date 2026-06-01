import { describe, it, expect } from "vitest";
import { checkRelayUrl } from "../../src/lib/relayUrlGuard.js";

describe("checkRelayUrl (SSRF guard)", () => {
  it("accepts a public wss relay and normalises it", () => {
    const r = checkRelayUrl("wss://groups.0xchat.com/", false);
    expect(r.ok).toBe(true);
    expect(r.url).toBe("wss://groups.0xchat.com");
  });

  it("rejects non-ws(s) schemes", () => {
    expect(checkRelayUrl("https://evil.com", false).ok).toBe(false);
    expect(checkRelayUrl("file:///etc/passwd", false).ok).toBe(false);
    expect(checkRelayUrl("not a url", false).ok).toBe(false);
  });

  it("requires wss:// in production (allowInsecure=false)", () => {
    expect(checkRelayUrl("ws://relay.example.com", false).ok).toBe(false);
    expect(checkRelayUrl("ws://relay.example.com", true).ok).toBe(true);
  });

  it("rejects loopback / localhost", () => {
    expect(checkRelayUrl("ws://localhost:7777", true).ok).toBe(false);
    expect(checkRelayUrl("ws://127.0.0.1:7777", true).ok).toBe(false);
    expect(checkRelayUrl("wss://[::1]", false).ok).toBe(false);
  });

  it("rejects private + link-local + metadata addresses", () => {
    for (const host of ["10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(checkRelayUrl(`wss://${host}`, false).ok, host).toBe(false);
    }
  });

  it("rejects IPv6 ULA and link-local", () => {
    expect(checkRelayUrl("wss://[fd00::1]", false).ok).toBe(false);
    expect(checkRelayUrl("wss://[fe80::1]", false).ok).toBe(false);
  });

  it("rejects .local / .internal hostnames", () => {
    expect(checkRelayUrl("wss://relay.local", false).ok).toBe(false);
    expect(checkRelayUrl("wss://relay.internal", false).ok).toBe(false);
  });
});
