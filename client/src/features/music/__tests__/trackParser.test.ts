import { describe, it, expect } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { buildTrackEvent, buildAlbumEvent } from "../musicEventBuilder";
import { lunaVega } from "@/__tests__/fixtures/testUsers";

function makeEvent(kind: 31683 | 33123, extraTags: string[][]): NostrEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    pubkey: lunaVega.pubkey,
    created_at: 1718452800,
    kind,
    tags: [
      ["d", "slug"],
      ["title", "Title"],
      ["artist", "Luna Vega"],
      ...extraTags,
    ],
    content: "",
    sig: "0".repeat(128),
  };
}

describe("parseTrackEvent multi-space h tags", () => {
  it("collects every h tag into spaceIds, keeps the first as spaceId", () => {
    const track = parseTrackEvent(
      makeEvent(31683, [["h", "space-A"], ["p", "abc"], ["h", "space-B"]]),
    );
    expect(track.spaceIds).toEqual(["space-A", "space-B"]);
    expect(track.spaceId).toBe("space-A");
    expect(track.visibility).toBe("space");
  });

  it("single-h tracks are unchanged", () => {
    const track = parseTrackEvent(makeEvent(31683, [["h", "space-A"]]));
    expect(track.spaceIds).toEqual(["space-A"]);
    expect(track.spaceId).toBe("space-A");
    expect(track.visibility).toBe("space");
  });

  it("public tracks have an empty spaceIds and no spaceId", () => {
    const track = parseTrackEvent(makeEvent(31683, []));
    expect(track.spaceIds).toEqual([]);
    expect(track.spaceId).toBeUndefined();
    expect(track.visibility).toBe("public");
  });
});

describe("parseAlbumEvent multi-space h tags", () => {
  it("collects every h tag into spaceIds, keeps the first as spaceId", () => {
    const album = parseAlbumEvent(makeEvent(33123, [["h", "space-A"], ["h", "space-B"]]));
    expect(album.spaceIds).toEqual(["space-A", "space-B"]);
    expect(album.spaceId).toBe("space-A");
    expect(album.visibility).toBe("space");
  });
});

describe("builders emit one h tag per space", () => {
  const base = { title: "T", artist: "A", slug: "s", audioUrl: "https://x/y.mp3" };

  it("spaceIds produce one h tag each, deduped, in order", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...base,
      visibility: "space",
      spaceId: "space-A",
      spaceIds: ["space-A", "space-B", "space-A"],
    });
    expect(event.tags.filter((t) => t[0] === "h")).toEqual([
      ["h", "space-A"],
      ["h", "space-B"],
    ]);
  });

  it("falls back to spaceId when spaceIds is absent (single-h unchanged)", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...base,
      visibility: "space",
      spaceId: "space-A",
    });
    expect(event.tags.filter((t) => t[0] === "h")).toEqual([["h", "space-A"]]);
  });

  it("a parsed multi-space track round-trips through the builder intact", () => {
    const parsed = parseTrackEvent(makeEvent(31683, [["h", "space-A"], ["h", "space-B"]]));
    const rebuilt = buildTrackEvent(lunaVega.pubkey, {
      ...base,
      visibility: parsed.visibility,
      spaceId: parsed.spaceId,
      spaceIds: parsed.spaceIds,
    });
    expect(rebuilt.tags.filter((t) => t[0] === "h").map((t) => t[1])).toEqual(parsed.spaceIds);
  });

  it("album builder honours spaceIds too", () => {
    const event = buildAlbumEvent(lunaVega.pubkey, {
      title: "Al", artist: "A", slug: "al",
      visibility: "space", spaceIds: ["space-A", "space-B"],
    });
    expect(event.tags.filter((t) => t[0] === "h").map((t) => t[1])).toEqual(["space-A", "space-B"]);
  });
});
