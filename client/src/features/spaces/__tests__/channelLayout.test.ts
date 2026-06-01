import { describe, it, expect } from "vitest";
import { buildLayoutEvent, parseLayoutEvent, wiredLayoutDTag } from "../channelLayout";
import type { NostrEvent } from "@/types/nostr";
import type { Space, SpaceChannel } from "@/types/space";

const CREATOR = "creator-pk";

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "g1",
    hostRelay: "wss://groups.0xchat.com",
    name: "G",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    mode: "read-write",
    creatorPubkey: CREATOR,
    createdAt: 0,
    spaceType: "nip29-native",
    ...overrides,
  };
}

function makeChannel(o: Partial<SpaceChannel> & { id: string }): SpaceChannel {
  return {
    spaceId: "g1",
    type: "chat",
    label: `#${o.id}`,
    position: 0,
    isDefault: false,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
    ...o,
  };
}

function asEvent(unsigned: ReturnType<typeof buildLayoutEvent>, pubkey: string): NostrEvent {
  return { ...unsigned, id: "id", sig: "sig", pubkey };
}

describe("channelLayout", () => {
  it("round-trips a wired layout for an authorized author", () => {
    const channels = [
      makeChannel({ id: "chat", type: "chat", label: "#general", position: 0 }),
      makeChannel({ id: "notes", type: "notes", label: "#board", position: 1 }),
    ];
    const event = asEvent(buildLayoutEvent(CREATOR, "g1", channels), CREATOR);
    const parsed = parseLayoutEvent(event, makeSpace());
    expect(parsed).not.toBeNull();
    expect(parsed!.map((c) => c.type)).toEqual(["chat", "notes"]);
    expect(parsed!.map((c) => c.label)).toEqual(["#general", "#board"]);
    expect(parsed![0].isDefault).toBe(true);
    expect(parsed![1].isDefault).toBe(false);
  });

  it("rejects a layout from an unauthorized author", () => {
    const event = asEvent(
      buildLayoutEvent(CREATOR, "g1", [makeChannel({ id: "chat" })]),
      "someone-else",
    );
    expect(parseLayoutEvent(event, makeSpace())).toBeNull();
  });

  it("accepts a layout from an admin or the relay key", () => {
    const ev = buildLayoutEvent(CREATOR, "g1", [makeChannel({ id: "chat" })]);
    expect(parseLayoutEvent(asEvent(ev, "admin-pk"), makeSpace({ adminPubkeys: ["admin-pk"] }))).not.toBeNull();
    expect(parseLayoutEvent(asEvent(ev, "relay-pk"), makeSpace({ relayPubkey: "relay-pk" }))).not.toBeNull();
  });

  it("ignores a 30078 with a non-layout d-tag", () => {
    const event: NostrEvent = {
      id: "id",
      sig: "sig",
      pubkey: CREATOR,
      kind: 30078,
      created_at: 0,
      tags: [["d", "dm-read-state"], ["channel", "x", "chat", "#x"]],
      content: "",
    };
    expect(parseLayoutEvent(event, makeSpace())).toBeNull();
  });

  it("reads an Obelisk layout (lenient) and maps types", () => {
    const event: NostrEvent = {
      id: "id",
      sig: "sig",
      pubkey: CREATOR,
      kind: 30078,
      created_at: 0,
      tags: [
        ["d", "obelisk:layout:wss://groups.0xchat.com"],
        // ["channel", id, catId, position, type]
        ["channel", "c1", "cat1", "0", "text"],
        ["channel", "c2", "cat1", "1", "voice"],
      ],
      content: "",
    };
    const parsed = parseLayoutEvent(event, makeSpace());
    expect(parsed).not.toBeNull();
    expect(parsed!.map((c) => c.type)).toEqual(["chat", "voice"]);
  });

  it("uses the expected d-tag", () => {
    expect(wiredLayoutDTag("abc")).toBe("wired:layout:abc");
  });
});
