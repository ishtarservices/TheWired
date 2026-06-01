import { describe, it, expect } from "vitest";
import {
  formatGroupAddress,
  getSpaceType,
  hostToRelayUrl,
  isBackendBacked,
  isDecentralized,
  isEphemeralRelayHost,
  isNip29Native,
  nativeInviteAddress,
  parseGroupAddress,
  relayUrlToHost,
  spaceLocalKey,
} from "../spaceType";
import type { Space } from "@/types/space";

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "abc123",
    hostRelay: "wss://relay.thewired.app",
    name: "Test",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    mode: "read-write",
    creatorPubkey: "pk",
    createdAt: 0,
    ...overrides,
  };
}

describe("spaceType discriminant", () => {
  it("defaults a space with no spaceType to platform (legacy/cached)", () => {
    expect(getSpaceType(makeSpace())).toBe("platform");
    expect(isBackendBacked(makeSpace())).toBe(true);
    expect(isNip29Native(makeSpace())).toBe(false);
  });

  it("treats decentralized-alite as backend-backed", () => {
    const s = makeSpace({ spaceType: "decentralized-alite" });
    expect(isBackendBacked(s)).toBe(true);
    expect(isNip29Native(s)).toBe(false);
  });

  it("treats nip29-native as not backend-backed", () => {
    const s = makeSpace({ spaceType: "nip29-native" });
    expect(isBackendBacked(s)).toBe(false);
    expect(isNip29Native(s)).toBe(true);
  });

  it("isDecentralized is true for any non-platform space", () => {
    expect(isDecentralized(makeSpace())).toBe(false);
    expect(isDecentralized(makeSpace({ spaceType: "platform" }))).toBe(false);
    expect(isDecentralized(makeSpace({ spaceType: "decentralized-alite" }))).toBe(true);
    expect(isDecentralized(makeSpace({ spaceType: "nip29-native" }))).toBe(true);
  });
});

describe("nativeInviteAddress (the 'Not a member' invite fix)", () => {
  const groupRef = { host: "groups.0xchat.com", groupId: "abc123" };

  it("returns null for backend-backed spaces → caller uses the backend invite", () => {
    // Platform + A-lite have a backend invite endpoint; native does not.
    expect(nativeInviteAddress(makeSpace({ spaceType: "platform", groupRef }))).toBeNull();
    expect(
      nativeInviteAddress(makeSpace({ spaceType: "decentralized-alite", groupRef })),
    ).toBeNull();
    expect(nativeInviteAddress(makeSpace())).toBeNull(); // legacy → platform
  });

  it("returns the shareable group address for a native space", () => {
    const s = makeSpace({ spaceType: "nip29-native", groupRef });
    expect(nativeInviteAddress(s)).toBe("groups.0xchat.com'abc123");
  });

  it("returns null for a native space missing its groupRef (no address to share)", () => {
    expect(nativeInviteAddress(makeSpace({ spaceType: "nip29-native" }))).toBeNull();
  });

  it("produces an address the import flow can parse back (round-trip)", () => {
    const s = makeSpace({ spaceType: "nip29-native", groupRef });
    const address = nativeInviteAddress(s)!;
    // This is the contract: an invite for a native space is importable.
    expect(parseGroupAddress(address)).toEqual(groupRef);
  });

  it("round-trips the real self-hosted-tunnel case from the field", () => {
    const ref = {
      host: "scheme-quite-benz-association.trycloudflare.com",
      groupId: "c46de45579b1",
    };
    const s = makeSpace({ spaceType: "nip29-native", groupRef: ref });
    const address = nativeInviteAddress(s)!;
    expect(address).toBe("scheme-quite-benz-association.trycloudflare.com'c46de45579b1");
    expect(parseGroupAddress(address)).toEqual(ref);
  });
});

describe("isEphemeralRelayHost (temporary tunnel detection)", () => {
  it("flags Cloudflare quick-tunnel hosts as ephemeral", () => {
    expect(isEphemeralRelayHost("scheme-quite-benz-association.trycloudflare.com")).toBe(true);
    expect(isEphemeralRelayHost("wss://happy-cat-1234.trycloudflare.com")).toBe(true);
    expect(isEphemeralRelayHost("wss://foo.trycloudflare.com/")).toBe(true);
  });

  it("treats normal relays + branded tunnels as stable", () => {
    expect(isEphemeralRelayHost("groups.0xchat.com")).toBe(false);
    expect(isEphemeralRelayHost("wss://relay.thewired.app")).toBe(false);
    expect(isEphemeralRelayHost("abc123.relay.thewired.app")).toBe(false);
    expect(isEphemeralRelayHost("localhost:7777")).toBe(false);
  });
});

describe("parseGroupAddress", () => {
  it("parses host'groupid", () => {
    expect(parseGroupAddress("groups.0xchat.com'abcd1234")).toEqual({
      host: "groups.0xchat.com",
      groupId: "abcd1234",
    });
  });

  it("strips a ws/wss scheme and trailing slash from the host", () => {
    expect(parseGroupAddress("wss://groups.fiatjaf.com/'xyz")).toEqual({
      host: "groups.fiatjaf.com",
      groupId: "xyz",
    });
  });

  it("rejects malformed input", () => {
    expect(parseGroupAddress("no-separator")).toBeNull();
    expect(parseGroupAddress("'leading")).toBeNull();
    expect(parseGroupAddress("trailing'")).toBeNull();
    expect(parseGroupAddress("")).toBeNull();
  });

  it("round-trips through formatGroupAddress", () => {
    const ref = { host: "groups.0xchat.com", groupId: "g1" };
    expect(parseGroupAddress(formatGroupAddress(ref))).toEqual(ref);
  });
});

describe("hostToRelayUrl / relayUrlToHost", () => {
  it("defaults remote hosts to wss", () => {
    expect(hostToRelayUrl("groups.0xchat.com")).toBe("wss://groups.0xchat.com");
  });

  it("uses ws for localhost-style hosts", () => {
    expect(hostToRelayUrl("localhost:7777")).toBe("ws://localhost:7777");
    expect(hostToRelayUrl("127.0.0.1:7777")).toBe("ws://127.0.0.1:7777");
  });

  it("uses ws for LAN / private hosts (LAN-bind self-hosted relays have no TLS)", () => {
    // The bug: a LAN-bind invite host like 10.150.208.12:54417 was upgraded to
    // wss → TLS handshake fails against the plain-ws embedded relay.
    expect(hostToRelayUrl("10.150.208.12:54417")).toBe("ws://10.150.208.12:54417");
    expect(hostToRelayUrl("192.168.1.50:7777")).toBe("ws://192.168.1.50:7777");
    expect(hostToRelayUrl("172.16.4.4:7777")).toBe("ws://172.16.4.4:7777");
    expect(hostToRelayUrl("100.96.1.2:7777")).toBe("ws://100.96.1.2:7777"); // Tailscale CGNAT
    expect(hostToRelayUrl("relay.local:7777")).toBe("ws://relay.local:7777");
  });

  it("passes through an explicit scheme", () => {
    expect(hostToRelayUrl("wss://relay.example.com")).toBe("wss://relay.example.com");
  });

  it("extracts a bare host from a relay URL", () => {
    expect(relayUrlToHost("wss://groups.0xchat.com/")).toBe("groups.0xchat.com");
  });
});

describe("spaceLocalKey", () => {
  it("uses the bare id for platform spaces", () => {
    expect(spaceLocalKey(makeSpace())).toBe("abc123");
  });

  it("keys native spaces by host'groupId to avoid collisions", () => {
    const s = makeSpace({
      spaceType: "nip29-native",
      groupRef: { host: "groups.0xchat.com", groupId: "abc123" },
    });
    expect(spaceLocalKey(s)).toBe("groups.0xchat.com'abc123");
  });
});
