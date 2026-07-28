import { describe, it, expect } from "vitest";
import { EVENT_KINDS } from "@thewired/shared-types";
import {
  DEFAULT_SHOWCASE,
  MAX_SHOWCASE_ITEMS,
  SHOWCASE_D_TAG,
  parseShowcase,
  buildShowcaseEvent,
  type ProfileShowcase,
} from "../profileShowcase";

const PK = "a".repeat(64);
const TRACK = `31683:${PK}:song-1`;
const ALBUM = `33123:${PK}:album-1`;

describe("parseShowcase", () => {
  it("round-trips a built event's content", () => {
    const showcase: ProfileShowcase = {
      items: [
        { type: "track", addressableId: TRACK },
        { type: "album", addressableId: ALBUM },
      ],
    };
    const ev = buildShowcaseEvent(PK, showcase);
    expect(parseShowcase(ev.content)).toEqual(showcase);
  });

  it("drops malformed items", () => {
    const parsed = parseShowcase(
      JSON.stringify({
        items: [
          { type: "track", addressableId: TRACK },
          { type: "playlist", addressableId: "x" }, // bad type
          { type: "album" }, // missing addressableId
          { addressableId: ALBUM }, // missing type
          "nope",
        ],
      }),
    );
    expect(parsed.items).toEqual([{ type: "track", addressableId: TRACK }]);
  });

  it("returns empty on malformed content", () => {
    expect(parseShowcase("nope")).toEqual(DEFAULT_SHOWCASE);
    expect(parseShowcase(JSON.stringify({ items: "no" }))).toEqual(DEFAULT_SHOWCASE);
  });

  it("caps at MAX_SHOWCASE_ITEMS", () => {
    const many = Array.from({ length: MAX_SHOWCASE_ITEMS + 10 }, (_, i) => ({
      type: "track" as const,
      addressableId: `31683:${PK}:t${i}`,
    }));
    expect(parseShowcase(JSON.stringify({ items: many })).items).toHaveLength(
      MAX_SHOWCASE_ITEMS,
    );
  });
});

describe("buildShowcaseEvent", () => {
  it("builds a kind:30078 event with the showcase d-tag + mirrored a-tags", () => {
    const ev = buildShowcaseEvent(PK, {
      items: [
        { type: "track", addressableId: TRACK },
        { type: "album", addressableId: ALBUM },
      ],
    });
    expect(ev.kind).toBe(EVENT_KINDS.APP_SPECIFIC_DATA);
    expect(ev.tags).toEqual([
      ["d", SHOWCASE_D_TAG],
      ["a", TRACK],
      ["a", ALBUM],
    ]);
  });
});
