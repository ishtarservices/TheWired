import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { buildTrackEvent, buildAlbumEvent } from "../musicEventBuilder";
import { lunaVega, felixMoreau, marcusCole } from "@/__tests__/fixtures/testUsers";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import {
  selectProfileTracks,
  selectProfileAlbums,
} from "../musicSelectors";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
});

// ─── helpers ────────────────────────────────────────

function makeTrackEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    pubkey: lunaVega.pubkey,
    created_at: 1718452800,
    kind: 31683,
    tags: [
      ["d", "my-track"],
      ["title", "My Track"],
      ["artist", "Luna Vega"],
    ],
    content: "",
    sig: "0".repeat(128),
    ...overrides,
  };
}

function makeAlbumEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    pubkey: lunaVega.pubkey,
    created_at: 1718452800,
    kind: 33123,
    tags: [
      ["d", "my-album"],
      ["title", "My Album"],
      ["artist", "Luna Vega"],
    ],
    content: "",
    sig: "0".repeat(128),
    ...overrides,
  };
}

// ─── Parser: parseVisibility ────────────────────────

describe("parseTrackEvent visibility", () => {
  it("parses public track (no visibility tag)", () => {
    const event = makeTrackEvent();
    const track = parseTrackEvent(event);
    expect(track.visibility).toBe("public");
  });

  it("parses private track (new tag)", () => {
    const event = makeTrackEvent({
      tags: [
        ["d", "priv-track"],
        ["title", "Private Track"],
        ["artist", "Luna"],
        ["visibility", "private"],
      ],
    });
    const track = parseTrackEvent(event);
    expect(track.visibility).toBe("private");
  });

  it("parses unlisted track as private (backward compat)", () => {
    const event = makeTrackEvent({
      tags: [
        ["d", "old-track"],
        ["title", "Old Unlisted"],
        ["artist", "Luna"],
        ["visibility", "unlisted"],
      ],
    });
    const track = parseTrackEvent(event);
    expect(track.visibility).toBe("private");
  });

  it("parses space-scoped track (h-tag)", () => {
    const event = makeTrackEvent({
      tags: [
        ["d", "space-track"],
        ["title", "Space Track"],
        ["artist", "Luna"],
        ["h", "space-123"],
      ],
    });
    const track = parseTrackEvent(event);
    expect(track.visibility).toBe("space");
  });
});

describe("parseAlbumEvent visibility", () => {
  it("parses public album (no visibility tag)", () => {
    const event = makeAlbumEvent();
    const album = parseAlbumEvent(event);
    expect(album.visibility).toBe("public");
  });

  it("parses private album", () => {
    const event = makeAlbumEvent({
      tags: [
        ["d", "priv-album"],
        ["title", "Private Album"],
        ["artist", "Luna"],
        ["visibility", "private"],
      ],
    });
    const album = parseAlbumEvent(event);
    expect(album.visibility).toBe("private");
  });

  it("parses unlisted album as private (backward compat)", () => {
    const event = makeAlbumEvent({
      tags: [
        ["d", "old-album"],
        ["title", "Old Unlisted"],
        ["artist", "Luna"],
        ["visibility", "unlisted"],
      ],
    });
    const album = parseAlbumEvent(event);
    expect(album.visibility).toBe("private");
  });
});

// ─── Event Builder: visibility tags ─────────────────

describe("buildTrackEvent visibility tags", () => {
  it("adds no visibility tag for public", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      title: "Public Track",
      artist: "Luna",
      slug: "public-track",
      audioUrl: "https://example.com/audio.mp3",
      visibility: "public",
    });
    expect(event.tags.some((t) => t[0] === "visibility")).toBe(false);
    expect(event.tags.some((t) => t[0] === "h")).toBe(false);
  });

  it("adds private visibility tag", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      title: "Private Track",
      artist: "Luna",
      slug: "private-track",
      audioUrl: "https://example.com/audio.mp3",
      visibility: "private",
    });
    expect(event.tags).toContainEqual(["visibility", "private"]);
  });

  it("adds h-tag for space visibility", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      title: "Space Track",
      artist: "Luna",
      slug: "space-track",
      audioUrl: "https://example.com/audio.mp3",
      visibility: "space",
      spaceId: "space-456",
    });
    expect(event.tags).toContainEqual(["h", "space-456"]);
    expect(event.tags.some((t) => t[0] === "visibility")).toBe(false);
  });
});

describe("buildAlbumEvent visibility tags", () => {
  it("adds private visibility tag", () => {
    const event = buildAlbumEvent(lunaVega.pubkey, {
      title: "Private Album",
      artist: "Luna",
      slug: "private-album",
      visibility: "private",
    });
    expect(event.tags).toContainEqual(["visibility", "private"]);
  });

  it("adds h-tag for space visibility", () => {
    const event = buildAlbumEvent(lunaVega.pubkey, {
      title: "Space Album",
      artist: "Luna",
      slug: "space-album",
      visibility: "space",
      spaceId: "space-789",
    });
    expect(event.tags).toContainEqual(["h", "space-789"]);
  });
});

// ─── Selectors: visibility filtering ────────────────

describe("selectProfileTracks visibility filtering", () => {
  it("hides private tracks from non-owner viewers", () => {
    const store = createTestStore({
      identity: { pubkey: felixMoreau.pubkey } as any,
      music: {
        tracks: {
          [`31683:${lunaVega.pubkey}:public-track`]: {
            addressableId: `31683:${lunaVega.pubkey}:public-track`,
            eventId: "evt-1",
            pubkey: lunaVega.pubkey,
            title: "Public Track",
            artist: "Luna",
            artistPubkeys: [],
            featuredArtists: [],
            collaborators: [],
            hashtags: [],
            variants: [],
            createdAt: 1000,
            visibility: "public",
          },
          [`31683:${lunaVega.pubkey}:private-track`]: {
            addressableId: `31683:${lunaVega.pubkey}:private-track`,
            eventId: "evt-2",
            pubkey: lunaVega.pubkey,
            title: "Private Track",
            artist: "Luna",
            artistPubkeys: [],
            featuredArtists: [],
            collaborators: [],
            hashtags: [],
            variants: [],
            createdAt: 1001,
            visibility: "private",
          },
          [`31683:${lunaVega.pubkey}:space-track`]: {
            addressableId: `31683:${lunaVega.pubkey}:space-track`,
            eventId: "evt-3",
            pubkey: lunaVega.pubkey,
            title: "Space Track",
            artist: "Luna",
            artistPubkeys: [],
            featuredArtists: [],
            collaborators: [],
            hashtags: [],
            variants: [],
            createdAt: 1002,
            visibility: "space",
          },
        } as any,
        tracksByArtist: {
          [lunaVega.pubkey]: [
            `31683:${lunaVega.pubkey}:public-track`,
            `31683:${lunaVega.pubkey}:private-track`,
            `31683:${lunaVega.pubkey}:space-track`,
          ],
        },
      } as any,
    });

    const selector = selectProfileTracks(lunaVega.pubkey);
    const tracks = selector(store.getState());

    // Felix (non-owner) should only see the public track
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("Public Track");
  });

  it("shows all tracks to the owner", () => {
    const store = createTestStore({
      identity: { pubkey: lunaVega.pubkey } as any,
      music: {
        tracks: {
          [`31683:${lunaVega.pubkey}:public-track`]: {
            addressableId: `31683:${lunaVega.pubkey}:public-track`,
            eventId: "evt-1",
            pubkey: lunaVega.pubkey,
            title: "Public Track",
            artist: "Luna",
            artistPubkeys: [],
            featuredArtists: [],
            collaborators: [],
            hashtags: [],
            variants: [],
            createdAt: 1000,
            visibility: "public",
          },
          [`31683:${lunaVega.pubkey}:private-track`]: {
            addressableId: `31683:${lunaVega.pubkey}:private-track`,
            eventId: "evt-2",
            pubkey: lunaVega.pubkey,
            title: "Private Track",
            artist: "Luna",
            artistPubkeys: [],
            featuredArtists: [],
            collaborators: [],
            hashtags: [],
            variants: [],
            createdAt: 1001,
            visibility: "private",
          },
        } as any,
        tracksByArtist: {
          [lunaVega.pubkey]: [
            `31683:${lunaVega.pubkey}:public-track`,
            `31683:${lunaVega.pubkey}:private-track`,
          ],
        },
      } as any,
    });

    const selector = selectProfileTracks(lunaVega.pubkey);
    const tracks = selector(store.getState());

    // Luna (owner) sees all her tracks
    expect(tracks).toHaveLength(2);
  });

  it("shows private tracks to featured collaborators", () => {
    const store = createTestStore({
      identity: { pubkey: felixMoreau.pubkey } as any,
      music: {
        tracks: {
          [`31683:${lunaVega.pubkey}:collab-track`]: {
            addressableId: `31683:${lunaVega.pubkey}:collab-track`,
            eventId: "evt-4",
            pubkey: lunaVega.pubkey,
            title: "Collab Track",
            artist: "Luna ft. Felix",
            artistPubkeys: [lunaVega.pubkey],
            featuredArtists: [felixMoreau.pubkey],
            collaborators: [],
            hashtags: [],
            variants: [],
            createdAt: 1003,
            visibility: "private",
          },
        } as any,
        tracksByArtist: {
          [lunaVega.pubkey]: [`31683:${lunaVega.pubkey}:collab-track`],
        },
      } as any,
    });

    const selector = selectProfileTracks(lunaVega.pubkey);
    const tracks = selector(store.getState());

    // Felix is a featured artist — should see the private track
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("Collab Track");
  });
});

describe("selectProfileAlbums visibility filtering", () => {
  it("hides non-public albums from non-owner viewers", () => {
    const store = createTestStore({
      identity: { pubkey: marcusCole.pubkey } as any,
      music: {
        albums: {
          [`33123:${lunaVega.pubkey}:public-album`]: {
            addressableId: `33123:${lunaVega.pubkey}:public-album`,
            eventId: "evt-a1",
            pubkey: lunaVega.pubkey,
            title: "Public Album",
            artist: "Luna",
            artistPubkeys: [],
            featuredArtists: [],
            collaborators: [],
            projectType: "album",
            hashtags: [],
            trackRefs: [],
            trackCount: 0,
            createdAt: 1000,
            visibility: "public",
          },
          [`33123:${lunaVega.pubkey}:private-album`]: {
            addressableId: `33123:${lunaVega.pubkey}:private-album`,
            eventId: "evt-a2",
            pubkey: lunaVega.pubkey,
            title: "Private Album",
            artist: "Luna",
            artistPubkeys: [],
            featuredArtists: [],
            collaborators: [],
            projectType: "album",
            hashtags: [],
            trackRefs: [],
            trackCount: 0,
            createdAt: 1001,
            visibility: "private",
          },
        } as any,
        albumsByArtist: {
          [lunaVega.pubkey]: [
            `33123:${lunaVega.pubkey}:public-album`,
            `33123:${lunaVega.pubkey}:private-album`,
          ],
        },
      } as any,
    });

    const selector = selectProfileAlbums(lunaVega.pubkey);
    const albums = selector(store.getState());

    // Marcus (non-owner, non-collaborator) sees only the public album
    expect(albums).toHaveLength(1);
    expect(albums[0].title).toBe("Public Album");
  });
});
