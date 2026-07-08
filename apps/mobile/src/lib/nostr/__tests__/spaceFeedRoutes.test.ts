import {
  AUTHORS_CHUNK,
  buildSpaceFeedFilters,
  isSpaceFeedType,
  selectFeedAuthors,
  SPACE_FEED_ROUTES,
} from "../spaceFeedRoutes";

describe("SPACE_FEED_ROUTES", () => {
  it("mirrors the desktop kind routes", () => {
    expect(SPACE_FEED_ROUTES.notes.kinds).toEqual([1, 1068]);
    expect(SPACE_FEED_ROUTES.media.kinds).toEqual([20, 21, 22, 34235, 34236]);
    expect(SPACE_FEED_ROUTES.articles.kinds).toEqual([30023]);
    expect(SPACE_FEED_ROUTES.music.kinds).toEqual([31683, 33123]);
  });

  it("isSpaceFeedType accepts only the four feed types", () => {
    expect(isSpaceFeedType("notes")).toBe(true);
    expect(isSpaceFeedType("music")).toBe(true);
    expect(isSpaceFeedType("chat")).toBe(false);
    expect(isSpaceFeedType("voice")).toBe(false);
  });
});

describe("selectFeedAuthors", () => {
  const members = ["m1", "m2"];
  const feedSources = ["f1"];

  it("curated → feed sources", () => {
    expect(selectFeedAuthors({ members, feedSources, curated: true })).toEqual(["f1"]);
  });

  it("curated with no sources falls back to members", () => {
    expect(selectFeedAuthors({ members, feedSources: [], curated: true })).toEqual(members);
  });

  it("community → members ∪ feed sources, deduped", () => {
    expect(
      selectFeedAuthors({ members: ["m1", "f1"], feedSources: ["f1"], curated: false }),
    ).toEqual(["m1", "f1"]);
  });
});

describe("buildSpaceFeedFilters", () => {
  it("returns [] with no authors", () => {
    expect(buildSpaceFeedFilters("notes", [])).toEqual([]);
  });

  it("builds one filter with kinds/limit for a small author set", () => {
    const filters = buildSpaceFeedFilters("articles", ["a", "b"]);
    expect(filters).toEqual([{ kinds: [30023], authors: ["a", "b"], limit: 10 }]);
  });

  it("chunks authors at 500 per filter (desktop parity)", () => {
    const authors = Array.from({ length: AUTHORS_CHUNK + 1 }, (_, i) => `pk${i}`);
    const filters = buildSpaceFeedFilters("notes", authors);
    expect(filters).toHaveLength(2);
    expect(filters[0].authors).toHaveLength(AUTHORS_CHUNK);
    expect(filters[1].authors).toEqual([`pk${AUTHORS_CHUNK}`]);
  });

  it("threads until for pagination", () => {
    const [filter] = buildSpaceFeedFilters("media", ["a"], 1234);
    expect(filter.until).toBe(1234);
    const [noUntil] = buildSpaceFeedFilters("media", ["a"]);
    expect(noUntil.until).toBeUndefined();
  });
});
