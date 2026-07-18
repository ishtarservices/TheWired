import {
  addressableId,
  formatTrackDuration,
  isPlayable,
  parseArtistPubkeys,
  parseMusicEvent,
  parseVariants,
  parseVisibility,
  selectAudioVariant,
} from "../musicEventParser";
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

const IMETA = (parts: string[]): string[] => ["imeta", ...parts];

describe("parseMusicEvent", () => {
  it("parses a 31683 track (backward-compatible fields)", () => {
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
    expect(item).toMatchObject({ kind: "album", title: "LP", trackCount: 2, audioUrl: null });
  });

  it("defaults title, drops non-https artwork, ignores other kinds", () => {
    const item = parseMusicEvent(event(31683, [["image", "http://x/a.jpg"]]));
    expect(item).toMatchObject({ title: "Untitled", artwork: null });
    expect(parseMusicEvent(event(1, []))).toBeNull();
  });

  it("extracts addressableId, audio url, mime and hash from imeta", () => {
    const item = parseMusicEvent(
      event(31683, [
        ["d", "track-1"],
        ["title", "T"],
        IMETA(["url https://cdn.x/a.mp3", "m audio/mpeg", "x abc123", "size 4096"]),
      ]),
    );
    expect(item).toMatchObject({
      addressableId: `31683:${"p".repeat(64)}:track-1`,
      audioUrl: "https://cdn.x/a.mp3",
      mime: "audio/mpeg",
      hash: "abc123",
    });
    expect(isPlayable(item!)).toBe(true);
  });

  it("falls back to imeta duration when no duration tag", () => {
    const item = parseMusicEvent(
      event(31683, [
        ["d", "t"],
        IMETA(["url https://cdn.x/a.mp3", "m audio/mpeg", "duration 95.6"]),
      ]),
    );
    expect(item?.durationSec).toBe(96);
  });

  it("parses parent album ref (33123 a-tag only)", () => {
    const item = parseMusicEvent(
      event(31683, [
        ["d", "t"],
        ["a", "31683:pk:sibling"],
        ["a", "33123:pk:the-album"],
      ]),
    );
    expect(item?.albumRef).toBe("33123:pk:the-album");
  });
});

describe("parseVariants + selectAudioVariant", () => {
  it("parses url/m/x/bitrate/duration per imeta entry", () => {
    const vs = parseVariants(
      event(31683, [
        IMETA(["url https://x/a.mp3", "m audio/mpeg", "x h1", "bitrate 128000"]),
      ]),
    );
    expect(vs).toEqual([
      { url: "https://x/a.mp3", mime: "audio/mpeg", hash: "h1", bitrate: 128000 },
    ]);
  });

  it("raw-scan fallback keeps a url-only imeta (no mime)", () => {
    const vs = parseVariants(event(31683, [IMETA(["url https://x/a.mp3"])]));
    expect(vs).toEqual([{ url: "https://x/a.mp3" }]);
  });

  it("prefers the highest-bitrate audio variant", () => {
    const chosen = selectAudioVariant([
      { url: "lo", mime: "audio/mpeg", bitrate: 128000 },
      { url: "hi", mime: "audio/mpeg", bitrate: 256000 },
      { url: "img", mime: "image/png", bitrate: 999999 },
    ]);
    expect(chosen?.url).toBe("hi");
  });

  it("returns undefined for no variants", () => {
    expect(selectAudioVariant([])).toBeUndefined();
  });
});

describe("parseVisibility", () => {
  it("public when no h/visibility tag", () => {
    expect(parseVisibility(event(31683, [["title", "x"]]))).toBe("public");
  });
  it("space when an h tag is present", () => {
    expect(parseVisibility(event(31683, [["h", "space1"]]))).toBe("space");
  });
  it("private for visibility private/unlisted", () => {
    expect(parseVisibility(event(31683, [["visibility", "private"]]))).toBe("private");
    expect(parseVisibility(event(31683, [["visibility", "unlisted"]]))).toBe("private");
  });
  it("space-scoped item carries spaceId + is not playable if private, exposes h", () => {
    const item = parseMusicEvent(
      event(31683, [
        ["d", "t"],
        ["h", "neon"],
        ["channel", "chan1"],
        IMETA(["url https://x/a.mp3", "m audio/mpeg"]),
      ]),
    );
    expect(item).toMatchObject({ visibility: "space", spaceId: "neon", channelId: "chan1" });
    expect(isPlayable(item!)).toBe(true); // space tracks play (soft exclusivity)
  });

  it("private track is never playable even with an audio url", () => {
    const item = parseMusicEvent(
      event(31683, [
        ["d", "t"],
        ["visibility", "private"],
        IMETA(["url https://x/a.mp3", "m audio/mpeg"]),
      ]),
    );
    expect(isPlayable(item!)).toBe(false);
  });
});

describe("parseArtistPubkeys", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("reads roled artist + featured p-tags in order, deduped", () => {
    const pks = parseArtistPubkeys(
      event(31683, [
        ["p", A, "", "artist"],
        ["p", B, "", "featured"],
        ["p", A, "", "featured"],
      ]),
    );
    expect(pks).toEqual([A, B]);
  });

  it("legacy: non-author p-tags treated as featured", () => {
    const pks = parseArtistPubkeys(
      event(31683, [
        ["p", "p".repeat(64)], // author — excluded
        ["p", A],
      ]),
    );
    expect(pks).toEqual([A]);
  });
});

describe("addressableId", () => {
  it("is kind:pubkey:d", () => {
    expect(addressableId(event(33123, [["d", "lp"]]))).toBe(`33123:${"p".repeat(64)}:lp`);
  });
});

describe("formatTrackDuration", () => {
  it("formats m:ss", () => {
    expect(formatTrackDuration(212)).toBe("3:32");
    expect(formatTrackDuration(59)).toBe("0:59");
    expect(formatTrackDuration(600)).toBe("10:00");
  });
});
