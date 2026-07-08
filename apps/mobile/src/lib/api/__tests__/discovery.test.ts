import { parseCategories, parseListedSpaces } from "../discovery";

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

describe("parseListedSpaces", () => {
  it("parses the backend {data: [...]} envelope", () => {
    const spaces = parseListedSpaces({ data: [SPACE] });
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({
      id: "seed1",
      name: "Anime & Manga",
      memberCount: 14,
      featured: true,
      tags: ["anime", "manga"],
    });
  });

  it("degrades to [] on shape changes instead of crashing", () => {
    expect(parseListedSpaces(null)).toEqual([]);
    expect(parseListedSpaces("nope")).toEqual([]);
    expect(parseListedSpaces({ data: "nope" })).toEqual([]);
    expect(parseListedSpaces({ spaces: [SPACE] })).toEqual([]);
  });

  it("drops malformed entries and defaults missing fields", () => {
    const spaces = parseListedSpaces({
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
    });
  });

  it("filters non-string tags", () => {
    const spaces = parseListedSpaces({
      data: [{ ...SPACE, tags: ["good", 42, null, "also"] }],
    });
    expect(spaces[0].tags).toEqual(["good", "also"]);
  });
});

describe("parseCategories", () => {
  it("parses slug-keyed rows with spaceCount", () => {
    const categories = parseCategories({
      data: [
        { slug: "culture", name: "Culture", spaceCount: 7, icon: "🎌", position: 1 },
        { slug: "dev", name: "Dev" },
        { name: "no slug" },
        null,
      ],
    });
    expect(categories).toEqual([
      { slug: "culture", name: "Culture", spaceCount: 7 },
      { slug: "dev", name: "Dev", spaceCount: 0 },
    ]);
  });

  it("degrades to [] on junk", () => {
    expect(parseCategories(null)).toEqual([]);
    expect(parseCategories({ data: {} })).toEqual([]);
  });
});
