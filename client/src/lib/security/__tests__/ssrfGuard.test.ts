import { describe, it, expect } from "vitest";
import {
  assertSafeFetchUrl,
  isSafeRelayUrl,
  isUnsafeHost,
  isUnsafeIp,
  SsrfBlockedError,
} from "../ssrfGuard";

describe("isUnsafeIp", () => {
  const unsafe = [
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "[::1]", // bracketed
    "::ffff:127.0.0.1", // IPv4-mapped loopback
  ];
  it.each(unsafe)("flags %s as unsafe", (ip) => expect(isUnsafeIp(ip)).toBe(true));

  const safe = [
    "1.2.3.4",
    "8.8.8.8",
    "172.15.0.1", // just outside private range
    "172.32.0.1",
    "192.167.0.1",
    "2606:4700:4700::1111", // public IPv6 (Cloudflare)
  ];
  it.each(safe)("allows public %s", (ip) => expect(isUnsafeIp(ip)).toBe(false));
});

describe("isUnsafeHost", () => {
  it.each(["localhost", "ip6-localhost", "foo.local", "svc.internal"])(
    "flags %s",
    (h) => expect(isUnsafeHost(h)).toBe(true),
  );
  it.each(["example.com", "walletofsatoshi.com", "abcdef.onion"])(
    "allows %s",
    (h) => expect(isUnsafeHost(h)).toBe(false),
  );
});

describe("assertSafeFetchUrl", () => {
  const blocked = [
    // literal internal hosts
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://[::1]/x",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/x",
    "https://192.168.1.1/x",
    "https://172.20.0.1/x",
    "https://100.64.0.1/x",
    "https://foo.local/x",
    "https://svc.internal/x",
    // alternate IP encodings — WHATWG URL normalises these to dotted form
    "https://2130706433/", // == 127.0.0.1
    "https://0x7f.0.0.1/", // hex
    "https://0177.0.0.1/", // octal
    // disallowed schemes
    "http://example.com/x", // plain http (non-onion)
    "ftp://example.com/x",
    "javascript:alert(1)",
    "ws://example.com/x",
    "", // malformed
  ];
  it.each(blocked)("blocks %s", (u) =>
    expect(() => assertSafeFetchUrl(u)).toThrow(SsrfBlockedError),
  );

  const allowed = [
    "https://example.com/.well-known/lnurlp/alice",
    "https://walletofsatoshi.com/cb?amount=1000",
    "https://1.2.3.4/x",
    "http://abcdefabcdef.onion/.well-known/lnurlp/a", // Tor over http
  ];
  it.each(allowed)("allows %s and returns it unchanged", (u) =>
    expect(assertSafeFetchUrl(u)).toBe(u),
  );
});

describe("isSafeRelayUrl", () => {
  it.each(["wss://relay.damus.io", "ws://relay.example.com/", "wss://1.2.3.4"])(
    "allows %s",
    (u) => expect(isSafeRelayUrl(u)).toBe(true),
  );
  it.each([
    "ws://127.0.0.1:7787", // the embedded relay address — must be dropped from event data
    "ws://localhost:7787",
    "wss://192.168.1.1",
    "ws://[::1]",
    "https://example.com", // wrong scheme
    "not a url",
  ])("blocks %s", (u) => expect(isSafeRelayUrl(u)).toBe(false));
});
