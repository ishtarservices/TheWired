import {
  parseMySpaces,
  parseSpaceChannels,
  parseSpaceDetail,
  parseSpaceMemberRoles,
  parseSpaceRoles,
} from "../spaces";

describe("parseSpaceDetail", () => {
  it("parses the {data} envelope with the full directory row", () => {
    const detail = parseSpaceDetail({
      data: {
        id: "my-space",
        name: "My Space",
        about: "hello",
        picture: "https://x/p.png",
        hostRelay: "wss://relay.thewired.app",
        spaceMode: "platform",
        tags: ["music", 42, "art"],
        category: "culture",
        mode: "read-write",
        memberCount: 12,
        activeMembers24h: 3,
        messagesLast24h: 87,
        featured: true,
        createdAt: 1700000000,
        creatorPubkey: "a".repeat(64),
      },
    });
    expect(detail).toEqual({
      id: "my-space",
      name: "My Space",
      about: "hello",
      picture: "https://x/p.png",
      hostRelay: "wss://relay.thewired.app",
      spaceMode: "platform",
      tags: ["music", "art"],
      category: "culture",
      mode: "read-write",
      memberCount: 12,
      activeMembers24h: 3,
      messagesLast24h: 87,
      featured: true,
      createdAt: 1700000000,
      creatorPubkey: "a".repeat(64),
    });
  });

  it("defaults the extended fields on minimal rows", () => {
    const detail = parseSpaceDetail({ data: { id: "s", name: "S" } });
    expect(detail).toMatchObject({
      category: null,
      mode: "read-write",
      memberCount: 0,
      activeMembers24h: 0,
      messagesLast24h: 0,
      featured: false,
      createdAt: null,
      creatorPubkey: null,
    });
  });

  it("returns null for junk", () => {
    expect(parseSpaceDetail(null)).toBeNull();
    expect(parseSpaceDetail({})).toBeNull();
    expect(parseSpaceDetail({ data: { name: "no id" } })).toBeNull();
  });
});

describe("parseSpaceChannels", () => {
  it("keeps well-formed channels, defaults labels and extended fields", () => {
    const channels = parseSpaceChannels({
      data: [
        {
          id: "c1",
          type: "chat",
          label: "#general",
          isDefault: true,
          categoryId: "text",
          position: 0,
          adminOnly: false,
          slowModeSeconds: 5,
          feedMode: "all",
        },
        { id: "c2", type: "music" },
        { bad: true },
        null,
      ],
    });
    expect(channels).toEqual([
      {
        id: "c1",
        type: "chat",
        label: "general",
        isDefault: true,
        categoryId: "text",
        position: 0,
        adminOnly: false,
        slowModeSeconds: 5,
        feedMode: "all",
      },
      {
        id: "c2",
        type: "music",
        label: "music",
        isDefault: false,
        categoryId: null,
        position: 0,
        adminOnly: false,
        slowModeSeconds: 0,
        feedMode: "all",
      },
    ]);
  });

  it("sorts by position", () => {
    const channels = parseSpaceChannels({
      data: [
        { id: "b", type: "notes", position: 2 },
        { id: "a", type: "chat", position: 1 },
      ],
    });
    expect(channels.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("degrades to empty on shape changes", () => {
    expect(parseSpaceChannels({ data: "nope" })).toEqual([]);
    expect(parseSpaceChannels(undefined)).toEqual([]);
  });
});

describe("parseSpaceRoles", () => {
  it("parses roles sorted by position", () => {
    const roles = parseSpaceRoles({
      data: [
        { id: "r2", name: "Members", position: 999, color: null, isDefault: true, isAdmin: false },
        { id: "r1", name: "Admin", position: 0, color: "#ff0000", isDefault: false, isAdmin: true },
        { junk: true },
      ],
    });
    expect(roles.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(roles[0]).toEqual({
      id: "r1",
      name: "Admin",
      position: 0,
      color: "#ff0000",
      isDefault: false,
      isAdmin: true,
    });
  });
});

describe("parseSpaceMemberRoles", () => {
  it("parses members with nested roles, tolerating junk", () => {
    const members = parseSpaceMemberRoles({
      data: [
        {
          pubkey: "a".repeat(64),
          roles: [{ id: "r1", name: "Admin", position: 0, isAdmin: true }, { bad: 1 }],
          joinedAt: "2026-01-01T00:00:00Z",
        },
        { pubkey: "b".repeat(64) },
        { roles: [] },
      ],
    });
    expect(members).toHaveLength(2);
    expect(members[0].pubkey).toBe("a".repeat(64));
    expect(members[0].roles).toHaveLength(1);
    expect(members[0].roles[0]).toMatchObject({ id: "r1", isAdmin: true, color: null });
    expect(members[1].roles).toEqual([]);
  });
});

describe("parseMySpaces", () => {
  it("parses the {space, channels, feedPubkeys} items (minimal space shape)", () => {
    const spaces = parseMySpaces({
      data: [
        {
          space: {
            id: "s1",
            name: "Mine",
            picture: null,
            about: "x",
            mode: "read-write",
            hostRelay: "wss://r",
            creatorPubkey: "a".repeat(64),
            memberCount: 4,
          },
          channels: [],
          feedPubkeys: [],
        },
        { space: { name: "no id" } },
        { notASpace: true },
      ],
    });
    expect(spaces).toEqual([
      {
        id: "s1",
        name: "Mine",
        about: "x",
        picture: null,
        hostRelay: "wss://r",
        mode: "read-write",
        memberCount: 4,
      },
    ]);
  });

  it("degrades to empty on junk", () => {
    expect(parseMySpaces(null)).toEqual([]);
    expect(parseMySpaces({ data: "x" })).toEqual([]);
  });
});
