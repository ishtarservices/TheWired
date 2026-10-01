import { describe, it, expect } from "vitest";
import { checkHostRelayUrl, checkRelayUrl, isPrivateHost } from "../../src/lib/relayUrlGuard.js";

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

describe("IPv6 / encoding bypasses", () => {
  it("decodes IPv4-mapped addresses even after URL normalisation to hex", () => {
    // new URL("wss://[::ffff:127.0.0.1]").hostname === "[::ffff:7f00:1]"
    expect(checkRelayUrl("wss://[::ffff:127.0.0.1]", false).ok).toBe(false);
    expect(checkRelayUrl("wss://[::ffff:10.1.2.3]", false).ok).toBe(false);
    expect(checkRelayUrl("wss://[::ffff:169.254.169.254]", false).ok).toBe(false);
    expect(checkRelayUrl("wss://[::ffff:8.8.8.8]", false).ok).toBe(true);
  });

  it("rejects NAT64 / 6to4 / compatible forms embedding a private IPv4", () => {
    expect(checkRelayUrl("wss://[64:ff9b::7f00:1]", false).ok).toBe(false);
    expect(checkRelayUrl("wss://[2002:c0a8:0101::1]", false).ok).toBe(false); // 6to4 of 192.168.1.1
    expect(checkRelayUrl("wss://[::127.0.0.1]", false).ok).toBe(false);
  });

  it("rejects multicast, site-local and documentation ranges; keeps public v6", () => {
    for (const host of ["[ff02::1]", "[fec0::1]", "[2001:db8::1]", "[::]", "[fc12::1]"]) {
      expect(checkRelayUrl(`wss://${host}`, false).ok, host).toBe(false);
    }
    expect(checkRelayUrl("wss://[2606:4700::1111]", false).ok).toBe(true);
  });

  it("rejects decimal / hex IPv4 spellings of loopback (URL normalises them)", () => {
    expect(checkRelayUrl("wss://2130706433", false).ok).toBe(false);
    expect(checkRelayUrl("wss://0x7f.1", false).ok).toBe(false);
  });

  it("rejects trailing-dot and single-label private names", () => {
    expect(checkRelayUrl("wss://localhost.", false).ok).toBe(false);
    expect(checkRelayUrl("wss://relay.local.", false).ok).toBe(false);
    expect(checkRelayUrl("wss://relay", false).ok).toBe(false);
    expect(isPrivateHost("nas.home.arpa")).toBe(true);
    expect(isPrivateHost("printer.lan")).toBe(true);
    expect(isPrivateHost("relay.damus.io")).toBe(false);
  });

  it("rejects CGNAT and benchmark ranges", () => {
    for (const host of ["100.127.255.254", "198.18.0.1", "198.19.255.1", "192.0.0.8"]) {
      expect(checkRelayUrl(`wss://${host}`, false).ok, host).toBe(false);
    }
  });
});

describe("checkHostRelayUrl (a space's hostRelay)", () => {
  const own = ["ws://localhost:7777", "wss://relay.thewired.app"];

  it("requires wss:// on a public host", () => {
    expect(checkHostRelayUrl("wss://relay.damus.io", own).ok).toBe(true);
    expect(checkHostRelayUrl("ws://relay.damus.io", own).ok).toBe(false);
    expect(checkHostRelayUrl("wss://192.168.1.10:7787", own).ok).toBe(false);
    expect(checkHostRelayUrl("wss://100.64.1.2", own).ok).toBe(false);
    expect(checkHostRelayUrl("wss://[fd12:3456::1]", own).ok).toBe(false);
    expect(checkHostRelayUrl("https://relay.damus.io", own).ok).toBe(false);
  });

  it("always accepts the platform's own relay, as submitted", () => {
    expect(checkHostRelayUrl("ws://localhost:7777", own)).toEqual({ ok: true, url: "ws://localhost:7777" });
    expect(checkHostRelayUrl("wss://relay.thewired.app/", own)).toEqual({ ok: true, url: "wss://relay.thewired.app/" });
    expect(checkHostRelayUrl("ws://127.0.0.1:7777", own).ok).toBe(false);
  });
});
