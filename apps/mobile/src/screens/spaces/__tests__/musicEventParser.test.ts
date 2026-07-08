import { formatTrackDuration, parseMusicEvent } from "../musicEventParser";
import type { NostrEvent } from "@thewired/shared-types";

const event = (kind: number, tags: string[][]): NostrEvent => ({
  id: "e1",
  pubkey: "p".repeat(64),
  created_at: 1,
  kind,
  tags,
  content: "",
  sig: "",
});

describe("parseMusicEvent", () => {
  it("parses a 31683 track", () => {
    const item = parseMusicEvent(
      event(31683, [
        ["d", "slug"],
        ["title", "Signal"],
        ["artist", "Lain"],
        ["image", "https://cdn.x/art.jpg"],
        ["duration", "212.4"],
      ]),
    );
    expect(item).toMatchObject({
      kind: "track",
      title: "Signal",
      artist: "Lain",
      artwork: "https://cdn.x/art.jpg",
      durationSec: 212,
    });
  });

  it("parses a 33123 album with a track count from a-refs", () => {
    const item = parseMusicEvent(
      event(33123, [
        ["title", "LP"],
        ["a", "31683:pk:t1"],
        ["a", "31683:pk:t2"],
        ["a", "30023:pk:not-a-track"],
      ]),
    );
    expect(item).toMatchObject({ kind: "album", title: "LP", trackCount: 2 });
  });

  it("defaults title, drops non-https artwork, ignores other kinds", () => {
    const item = parseMusicEvent(event(31683, [["image", "http://x/a.jpg"]]));
    expect(item).toMatchObject({ title: "Untitled", artwork: null });
    expect(parseMusicEvent(event(1, []))).toBeNull();
  });
});

describe("formatTrackDuration", () => {
  it("formats m:ss", () => {
    expect(formatTrackDuration(212)).toBe("3:32");
    expect(formatTrackDuration(59)).toBe("0:59");
    expect(formatTrackDuration(600)).toBe("10:00");
  });
});
