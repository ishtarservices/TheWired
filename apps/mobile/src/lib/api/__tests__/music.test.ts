import { parseBrowseTracks } from "../music";

const trackEvent = (id: string, tags: string[][]) => ({
  id,
  pubkey: "p".repeat(64),
  created_at: 1,
  kind: 31683,
  tags,
  content: "",
  sig: "",
});

describe("parseBrowseTracks", () => {
  it("parses the { data: { tracks } } envelope into music items", () => {
    const items = parseBrowseTracks({
      data: {
        tracks: [
          trackEvent("a", [["d", "t1"], ["title", "One"], ["artist", "X"]]),
          trackEvent("b", [["d", "t2"], ["title", "Two"]]),
        ],
        total: 2,
      },
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "One", artist: "X", kind: "track" });
  });

  it("drops malformed rows and non-music kinds", () => {
    const items = parseBrowseTracks({
      data: {
        tracks: [
          trackEvent("a", [["d", "t1"], ["title", "Keep"]]),
          { garbage: true },
          { ...trackEvent("c", []), kind: 1 }, // note, not music
          null,
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Keep");
  });

  it("degrades to empty on a shape change", () => {
    expect(parseBrowseTracks(null)).toEqual([]);
    expect(parseBrowseTracks({})).toEqual([]);
    expect(parseBrowseTracks({ data: {} })).toEqual([]);
    expect(parseBrowseTracks({ data: { tracks: "nope" } })).toEqual([]);
  });
});
