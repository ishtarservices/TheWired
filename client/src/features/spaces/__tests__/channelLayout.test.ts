import { describe, it, expect } from "vitest";
import {
  buildLayoutEvent,
  parseLayoutEvent,
  pickLayout,
  wiredLayoutDTag,
  nextLayoutCreatedAt,
  authorizedLayoutAuthors,
} from "../channelLayout";
import type { NostrEvent } from "@/types/nostr";
import type { Space, SpaceChannel, SpaceChannelCategory } from "@/types/space";

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

const cat = (id: string, position: number, name = id): SpaceChannelCategory => ({ id, spaceId: "g1", name, position });

function asEvent(unsigned: ReturnType<typeof buildLayoutEvent>, pubkey: string, id = "id"): NostrEvent {
  return { ...unsigned, id, sig: "sig", pubkey };
}

const build = (channels: SpaceChannel[], categories: SpaceChannelCategory[] = [], defaultChannelId?: string, createdAt = 100) =>
  buildLayoutEvent(CREATOR, "g1", { channels, categories, defaultChannelId }, createdAt);

describe("channelLayout", () => {
  it("round-trips channels, categories (real names, order) and the default", () => {
    const event = asEvent(
      build(
        [
          makeChannel({ id: "chat", label: "#general", position: 0 }),
          makeChannel({ id: "music1", type: "music", label: "#tunes", categoryId: "Hang", position: 1 }),
          makeChannel({ id: "notes", type: "notes", label: "#board", categoryId: "Dev", position: 2 }),
        ],
        [cat("Dev", 1, "Development"), cat("Hang", 0, "Hangout")],
      ),
      CREATOR,
    );
    expect(event.tags).toContainEqual(["h", "g1"]);
    expect(event.tags).toContainEqual(["default", "chat"]);
    const parsed = parseLayoutEvent(event, makeSpace())!;
    expect(parsed.convention).toBe("wired");
    expect(parsed.categories.map((c) => [c.id, c.name, c.position])).toEqual([
      ["Hang", "Hangout", 0],
      ["Dev", "Development", 1],
    ]);
    expect(parsed.channels.map((c) => [c.id, c.type, c.label, c.categoryId])).toEqual([
      ["chat", "chat", "#general", null],
      ["music1", "music", "#tunes", "Hang"],
      ["notes", "notes", "#board", "Dev"],
    ]);
    expect(parsed.channels.filter((c) => c.isDefault).map((c) => c.id)).toEqual(["chat"]);
  });

  it("pins the default to the `default` tag, else `chat` — never just whatever sorts first", () => {
    const channels = [
      makeChannel({ id: "voice", type: "voice", position: 0 }),
      makeChannel({ id: "chat", position: 1 }),
      makeChannel({ id: "other", position: 2 }),
    ];
    const noTag = asEvent({ ...build(channels), tags: build(channels).tags.filter((t) => t[0] !== "default") }, CREATOR);
    expect(parseLayoutEvent(noTag, makeSpace())!.channels.find((c) => c.isDefault)!.id).toBe("chat");
    const tagged = asEvent(build(channels, [], "other"), CREATOR);
    expect(parseLayoutEvent(tagged, makeSpace())!.channels.find((c) => c.isDefault)!.id).toBe("other");
    // A default naming a channel that isn't there falls back.
    const dangling = asEvent(build(channels, [], "ghost"), CREATOR);
    expect(parseLayoutEvent(dangling, makeSpace())!.channels.find((c) => c.isDefault)!.id).toBe("chat");
  });

  it("rejects a layout from an unauthorized author", () => {
    const event = asEvent(build([makeChannel({ id: "chat" })]), "someone-else");
    expect(parseLayoutEvent(event, makeSpace())).toBeNull();
  });

  it("accepts a layout from an admin or the relay key", () => {
    const ev = build([makeChannel({ id: "chat" })]);
    expect(parseLayoutEvent(asEvent(ev, "admin-pk"), makeSpace({ adminPubkeys: ["admin-pk"] }))).not.toBeNull();
    expect(parseLayoutEvent(asEvent(ev, "relay-pk"), makeSpace({ relayPubkey: "relay-pk" }))).not.toBeNull();
    expect(authorizedLayoutAuthors(makeSpace({ adminPubkeys: ["a", CREATOR], relayPubkey: "r" })).sort()).toEqual(
      ["a", CREATOR, "r"].sort(),
    );
  });

  it("ignores a 30078 with a non-layout d-tag, or another group's layout", () => {
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
    const otherGroup = asEvent(buildLayoutEvent(CREATOR, "g2", { channels: [makeChannel({ id: "chat" })], categories: [] }), CREATOR);
    expect(parseLayoutEvent(otherGroup, makeSpace())).toBeNull();
    const otherRelay: NostrEvent = { ...event, tags: [["d", "obelisk:layout:wss://elsewhere.example"], ["channel", "c1", "", "0"]] };
    expect(parseLayoutEvent(otherRelay, makeSpace())).toBeNull();
  });

  it("reads an Obelisk layout (lenient): maps types, unnamed categories become folders named by id", () => {
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
    const parsed = parseLayoutEvent(event, makeSpace())!;
    expect(parsed.convention).toBe("obelisk");
    expect(parsed.channels.map((c) => c.type)).toEqual(["chat", "voice"]);
    expect(parsed.channels.map((c) => c.categoryId)).toEqual(["cat1", "cat1"]);
    expect(parsed.categories).toEqual([]);
  });

  it("sends a wired channel that references an undefined category to uncategorized", () => {
    const event = asEvent(build([makeChannel({ id: "chat", categoryId: "ghost" })]), CREATOR);
    expect(parseLayoutEvent(event, makeSpace())!.channels[0].categoryId).toBeNull();
  });

  it("sanitizes untrusted names/labels and caps sizes", () => {
    const rlo = String.fromCharCode(0x202e);
    const event = asEvent(
      {
        ...build([]),
        tags: [
          ["d", wiredLayoutDTag("g1")],
          ["category", "c1", `evil${rlo}txt`, "0"],
          ["category", "c1", "dup", "1"],
          ["category", "c2", rlo, "2"],
          ["channel", "x".repeat(200), "chat", "y".repeat(500), "c1", "0"],
          ["channel", "dup", "bogus-type", `#a${rlo}b`, "c2", "1"],
          ["channel", "dup", "chat", "#second", "", "2"],
          ...Array.from({ length: 300 }, (_, i) => ["channel", `n${i}`, "chat", `#n${i}`, "", String(i + 3)]),
        ],
      },
      CREATOR,
    );
    const parsed = parseLayoutEvent(event, makeSpace())!;
    expect(parsed.categories.map((c) => [c.id, c.name])).toEqual([["c1", "eviltxt"], ["c2", "c2"]]);
    expect(parsed.channels).toHaveLength(200);
    expect(parsed.channels[0].id).toHaveLength(64);
    expect(parsed.channels[0].label).toHaveLength(64);
    const dup = parsed.channels.filter((c) => c.id === "dup");
    expect(dup).toHaveLength(1);
    expect(dup[0].type).toBe("chat");
    expect(dup[0].label).toBe("#ab");
  });

  it("uses the expected d-tag", () => {
    expect(wiredLayoutDTag("abc")).toBe("wired:layout:abc");
  });
});

describe("feedMode round-trip (curated channels in native spaces)", () => {
  it("writes `curated` as the 7th position and reads it back; absent = all", () => {
    const space = makeSpace();
    const unsigned = build([
      makeChannel({ id: "general", type: "chat", position: 0 }),
      makeChannel({ id: "shelf", type: "music", position: 1, feedMode: "curated" }),
      makeChannel({ id: "all-music", type: "music", position: 2 }),
    ]);
    const shelfTag = unsigned.tags.find((t) => t[0] === "channel" && t[1] === "shelf")!;
    expect(shelfTag[6]).toBe("curated");
    const allTag = unsigned.tags.find((t) => t[0] === "channel" && t[1] === "all-music")!;
    expect(allTag).toHaveLength(6);

    const parsed = parseLayoutEvent(asEvent(unsigned, CREATOR), space)!;
    expect(parsed.channels.find((c) => c.id === "shelf")?.feedMode).toBe("curated");
    expect(parsed.channels.find((c) => c.id === "all-music")?.feedMode).toBe("all");
    expect(parsed.channels.find((c) => c.id === "general")?.feedMode).toBe("all");
  });
});

describe("pickLayout", () => {
  const space = makeSpace({ adminPubkeys: ["admin-pk"] });
  const one = (label: string) => [makeChannel({ id: "chat", label })];

  it("prefers the newest authorized wired layout; ties break on the lower id", () => {
    const older = asEvent(build(one("#old"), [], undefined, 100), CREATOR, "bbb");
    const newer = asEvent(build(one("#new"), [], undefined, 200), "admin-pk", "ccc");
    const forged = asEvent(build(one("#forged"), [], undefined, 999), "stranger", "aaa");
    expect(pickLayout([older, forged, newer], space)!.layout.channels[0].label).toBe("#new");
    // Relays return newest first; order of arrival doesn't matter.
    expect(pickLayout([newer, older], space)!.event.id).toBe("ccc");
    const tieA = asEvent(build(one("#a"), [], undefined, 300), CREATOR, "aaa");
    const tieB = asEvent(build(one("#b"), [], undefined, 300), "admin-pk", "bbb");
    expect(pickLayout([tieB, tieA], space)!.event.id).toBe("aaa");
  });

  it("prefers our layout over a newer Obelisk one, and returns null when nothing is authorized", () => {
    const ours = asEvent(build(one("#ours"), [], undefined, 100), CREATOR, "w");
    const obelisk: NostrEvent = {
      id: "o",
      sig: "sig",
      pubkey: CREATOR,
      kind: 30078,
      created_at: 500,
      tags: [["d", "obelisk:layout:wss://groups.0xchat.com"], ["channel", "c1", "", "0", "text"]],
      content: "",
    };
    expect(pickLayout([obelisk, ours], space)!.event.id).toBe("w");
    expect(pickLayout([obelisk], space)!.event.id).toBe("o");
    expect(pickLayout([asEvent(build(one("#x")), "stranger")], space)).toBeNull();
  });
});

describe("nextLayoutCreatedAt", () => {
  it("is strictly after the previous layout but never more than 15 minutes ahead", () => {
    expect(nextLayoutCreatedAt(undefined, 1000)).toBe(1000);
    expect(nextLayoutCreatedAt(500, 1000)).toBe(1000);
    expect(nextLayoutCreatedAt(1000, 1000)).toBe(1001);
    expect(nextLayoutCreatedAt(99999, 1000)).toBe(1000 + 900);
  });
});
