import { describe, it, expect } from "vitest";
import { nativeInvitePlan } from "../nativeInvitePlan";
import type { Space } from "../../../types/space";

function nativeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "g1",
    hostRelay: "wss://old.trycloudflare.com",
    name: "Test",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    mode: "read-write",
    creatorPubkey: "pk",
    createdAt: 0,
    spaceType: "nip29-native",
    relayPubkey: "MYRELAY",
    groupRef: { host: "old.trycloudflare.com", groupId: "g1" },
    ...overrides,
  };
}

const myRelay = (
  running: boolean,
  extra: { ws_url?: string | null; lan_url?: string | null } = {},
) => ({ running, pubkey: "MYRELAY", ws_url: null, lan_url: null, ...extra });
const liveTunnel = (url: string) => ({ running: true, url });
const noTunnel = { running: false, url: null };

describe("nativeInvitePlan", () => {
  it("uses the CURRENT tunnel host when the space is hosted on my running relay", () => {
    // Stored host is stale ('old…'); the live tunnel is 'new…'.
    const plan = nativeInvitePlan(
      nativeSpace(),
      myRelay(true),
      liveTunnel("https://new-fresh-words.trycloudflare.com"),
    );
    expect(plan).toEqual({
      kind: "address",
      address: "new-fresh-words.trycloudflare.com'g1",
      scope: "public",
      ephemeral: true, // throwaway trycloudflare tunnel
    });
  });

  it("marks a branded (named) tunnel as a stable public address", () => {
    const plan = nativeInvitePlan(
      nativeSpace(),
      myRelay(true),
      liveTunnel("https://abc123.relay.thewired.app"),
    );
    expect(plan).toEqual({
      kind: "address",
      address: "abc123.relay.thewired.app'g1",
      scope: "public",
      ephemeral: false,
    });
  });

  it("tells the user to turn the relay on when it's mine but stopped", () => {
    expect(nativeInvitePlan(nativeSpace(), myRelay(false), noTunnel)).toEqual({
      kind: "relay-off",
    });
  });

  it("offers the LAN address when my relay is running with LAN access (no tunnel)", () => {
    const plan = nativeInvitePlan(
      nativeSpace(),
      myRelay(true, { ws_url: "ws://127.0.0.1:7787", lan_url: "ws://192.168.1.50:7787" }),
      noTunnel,
    );
    expect(plan).toEqual({
      kind: "address",
      address: "192.168.1.50:7787'g1",
      scope: "lan",
      ephemeral: false,
    });
  });

  it("offers the loopback address (local scope) when running with no tunnel or LAN", () => {
    const plan = nativeInvitePlan(
      nativeSpace(),
      myRelay(true, { ws_url: "ws://127.0.0.1:7787" }),
      noTunnel,
    );
    expect(plan).toEqual({
      kind: "address",
      address: "127.0.0.1:7787'g1",
      scope: "local",
      ephemeral: false,
    });
  });

  it("uses the stored stable address for an external (not-mine) relay", () => {
    const ext = nativeSpace({
      relayPubkey: "SOMEONE_ELSE",
      hostRelay: "wss://groups.0xchat.com",
      groupRef: { host: "groups.0xchat.com", groupId: "g1" },
    });
    expect(nativeInvitePlan(ext, myRelay(true), liveTunnel("https://x.trycloudflare.com"))).toEqual(
      { kind: "address", address: "groups.0xchat.com'g1", scope: "public", ephemeral: false },
    );
  });

  it("falls back to the stored address when relay status is unknown (web build)", () => {
    const plan = nativeInvitePlan(nativeSpace(), null, null);
    expect(plan).toEqual({
      kind: "address",
      address: "old.trycloudflare.com'g1",
      scope: "public",
      ephemeral: true, // stored host is a quick tunnel
    });
  });

  it("returns no-address for a native space without a groupRef", () => {
    expect(nativeInvitePlan(nativeSpace({ groupRef: undefined }), myRelay(true), noTunnel)).toEqual({
      kind: "no-address",
    });
  });
});
