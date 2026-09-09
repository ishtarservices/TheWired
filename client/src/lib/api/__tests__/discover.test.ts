import { describe, it, expect } from "vitest";
import { parseCategories, parseDiscoverSpaces, parseScenes } from "../discover";

const SPACE = {
  id: "seed1",
  name: "Anime & Manga",
  about: "Seasonal watch-alongs",
  picture: null,
  category: "culture",
  hostRelay: "wss://relay.thewired.app",
  spaceMode: "platform",
  memberCount: 14,
  activeMembers24h: 1,
  featured: true,
  listed: true,
  tags: ["anime", "manga"],
};

describe("parseDiscoverSpaces", () => {
  it("parses the backend {data: [...]} envelope", () => {
    const spaces = parseDiscoverSpaces({ data: [SPACE] });
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({
      id: "seed1",
      name: "Anime & Manga",
      memberCount: 14,
      featured: true,
      tags: ["anime", "manga"],
    });
  });

  it("accepts the bare array the api() wrapper hands back as .data", () => {
    expect(parseDiscoverSpaces([SPACE])).toHaveLength(1);
  });

  it("degrades to [] on shape changes instead of crashing", () => {
    expect(parseDiscoverSpaces(null)).toEqual([]);
    expect(parseDiscoverSpaces("nope")).toEqual([]);
    expect(parseDiscoverSpaces({ data: "nope" })).toEqual([]);
    expect(parseDiscoverSpaces({ spaces: [SPACE] })).toEqual([]);
  });

  it("drops malformed entries and defaults missing fields", () => {
    const spaces = parseDiscoverSpaces({
      data: [SPACE, { id: 42 }, { id: "ok", name: "Min" }],
    });
    expect(spaces).toHaveLength(2);
    expect(spaces[1]).toMatchObject({
      id: "ok",
      name: "Min",
      about: null,
      memberCount: 0,
      featured: false,
      tags: [],
      zapCount24h: 0,
      zapSats24h: 0,
    });
  });

  it("filters non-string tags", () => {
    const spaces = parseDiscoverSpaces({
      data: [{ ...SPACE, tags: ["good", 42, null, "also"] }],
    });
    expect(spaces[0].tags).toEqual(["good", "also"]);
  });

  it("parses the ranking/badging fields the directory used to discard", () => {
    const [space] = parseDiscoverSpaces({
      data: [
        {
          ...SPACE,
          mode: "read",
          language: "en",
          messagesLast24h: 12,
          discoveryScore: 66,
          zapCount24h: 3,
          zapSats24h: 2100,
          externalOrigin: true,
          creatorPubkey: "bf3fe8",
        },
      ],
    });
    expect(space).toMatchObject({
      mode: "read",
      language: "en",
      messagesLast24h: 12,
      discoveryScore: 66,
      zapCount24h: 3,
      zapSats24h: 2100,
      externalOrigin: true,
      creatorPubkey: "bf3fe8",
    });
  });

  it("defaults an unknown mode to read-write (never badge 'Feed' on a guess)", () => {
    const [absent] = parseDiscoverSpaces({ data: [SPACE] });
    const [junk] = parseDiscoverSpaces({ data: [{ ...SPACE, mode: 7 }] });
    const [garbage] = parseDiscoverSpaces({ data: [{ ...SPACE, mode: "readonly" }] });
    expect(absent.mode).toBe("read-write");
    expect(junk.mode).toBe("read-write");
    expect(garbage.mode).toBe("read-write");
  });

  it("accepts either ms-epoch numbers or ISO strings for the timestamps", () => {
    // The API really does mix these: createdAt is a number, listedAt is ISO.
    const [space] = parseDiscoverSpaces({
      data: [{ ...SPACE, createdAt: 1774865932023, listedAt: "2026-03-30T10:18:52.023Z" }],
    });
    expect(space.createdAt).toBe(1774865932023);
    expect(space.listedAt).toBe(Date.parse("2026-03-30T10:18:52.023Z"));
  });

  it("nulls unparseable timestamps rather than emitting NaN", () => {
    const [space] = parseDiscoverSpaces({
      data: [{ ...SPACE, createdAt: "not a date", listedAt: {} }],
    });
    expect(space.createdAt).toBeNull();
    expect(space.listedAt).toBeNull();
  });
});

describe("parseCategories", () => {
  it("parses slug-keyed rows with count, icon, description and position", () => {
    const categories = parseCategories({
      data: [
        {
          slug: "culture",
          name: "Culture",
          spaceCount: 7,
          icon: "Tv",
          description: "Pop culture",
          position: 1,
        },
        { slug: "dev", name: "Dev" },
        { name: "no slug" },
        null,
      ],
    });
    expect(categories).toEqual([
      { slug: "dev", name: "Dev", spaceCount: 0, icon: null, description: null, position: 0 },
      {
        slug: "culture",
        name: "Culture",
        spaceCount: 7,
        icon: "Tv",
        description: "Pop culture",
        position: 1,
      },
    ]);
  });

  it("orders rows by position, not arrival", () => {
    const categories = parseCategories({
      data: [
        { slug: "late", name: "Late", position: 30 },
        { slug: "early", name: "Early", position: 10 },
      ],
    });
    expect(categories.map((c) => c.slug)).toEqual(["early", "late"]);
  });

  it("degrades to [] on junk", () => {
    expect(parseCategories(null)).toEqual([]);
    expect(parseCategories({ data: {} })).toEqual([]);
  });
});

describe("parseScenes", () => {
  const SCENE = {
    slug: "alt-rap",
    label: "Alt Rap",
    description: "Left-of-centre rap",
    genres: ["hip hop", "rap"],
    tags: ["rap", "hiphop"],
    position: 10,
    spaceCount: 2,
  };

  it("parses rows and orders them by position, not arrival", () => {
    const scenes = parseScenes({
      data: [
        { ...SCENE, slug: "late", position: 60 },
        { ...SCENE, slug: "early", position: 10 },
      ],
    });
    expect(scenes.map((s) => s.slug)).toEqual(["early", "late"]);
  });

  it("drops malformed rows and non-string vocabulary entries", () => {
    const scenes = parseScenes({
      data: [{ ...SCENE, genres: ["ok", 42, null], tags: [1] }, { label: "no slug" }, null],
    });
    expect(scenes).toHaveLength(1);
    expect(scenes[0].genres).toEqual(["ok"]);
    expect(scenes[0].tags).toEqual([]);
  });

  it("degrades to [] so the client falls back to its bundled scenes", () => {
    expect(parseScenes(null)).toEqual([]);
    expect(parseScenes({ data: "nope" })).toEqual([]);
  });
});
