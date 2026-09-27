import { describe, it, expect } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import { parseTrackEvent, parsePrivateTrackEvent } from "../trackParser";
import { buildTrackEvent } from "../musicEventBuilder";
import {
  selectProfileTracks,
  selectLibraryTracks,
  selectMyTracks,
} from "../musicSelectors";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, felixMoreau } from "@/__tests__/fixtures/testUsers";
import type { MusicTrack } from "@/types/music";

/**
 * `["catalog","none"]` = a real, public, playable track its author keeps OFF
 * their catalog (mobile "audio attached to a note"). Not a visibility state.
 * Desktop must (1) parse it, (2) preserve it on every republish — rebuilding
 * tags from parsed fields used to silently re-list the clip — and (3) hide it
 * from author shelves while keeping it in My Music so the owner can re-list it.
 * docs/MUSIC_VISIBILITY.md §"Catalog listing".
 */

function makeEvent(extraTags: string[][], overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    pubkey: lunaVega.pubkey,
    created_at: 1718452800,
    kind: 31683,
    tags: [
      ["d", "clip"],
      ["title", "Clip"],
      ["artist", "Luna Vega"],
      ["imeta", "url https://cdn.example/clip.mp3", "m audio/mpeg", "x abc", "size 123"],
      ...extraTags,
    ],
    content: "",
    sig: "0".repeat(128),
    ...overrides,
  };
}

// ─── parse ──────────────────────────────────────────

describe("trackParser catalog listing", () => {
  it("catalog:none → inCatalog false", () => {
    expect(parseTrackEvent(makeEvent([["catalog", "none"]])).inCatalog).toBe(false);
  });

  it("absent tag → inCatalog true", () => {
    expect(parseTrackEvent(makeEvent([])).inCatalog).toBe(true);
  });

  it("any other catalog value → inCatalog true", () => {
    expect(parseTrackEvent(makeEvent([["catalog", "featured"]])).inCatalog).toBe(true);
    expect(parseTrackEvent(makeEvent([["catalog"]])).inCatalog).toBe(true);
  });

  it("is orthogonal to visibility: an unlisted clip is still public", () => {
    const track = parseTrackEvent(makeEvent([["catalog", "none"]]));
    expect(track.visibility).toBe("public");
    // The legacy visibility:unlisted state is a different concept (→ private).
    const legacy = parseTrackEvent(makeEvent([["visibility", "unlisted"]]));
    expect(legacy.visibility).toBe("private");
    expect(legacy.inCatalog).toBe(true);
  });

  it("parsePrivateTrackEvent reads the cleartext tag on the non-private fallback path", async () => {
    const track = await parsePrivateTrackEvent(makeEvent([["catalog", "none"]]), lunaVega.pubkey);
    expect(track?.inCatalog).toBe(false);
  });
});

// ─── build / preserve ───────────────────────────────

describe("musicEventBuilder catalog listing", () => {
  const base = {
    title: "Clip",
    artist: "Luna Vega",
    slug: "clip",
    audioUrl: "https://cdn.example/clip.mp3",
  };

  it("inCatalog: false emits ['catalog','none']", () => {
    const unsigned = buildTrackEvent(lunaVega.pubkey, { ...base, inCatalog: false });
    expect(unsigned.tags).toContainEqual(["catalog", "none"]);
  });

  it("inCatalog omitted or true emits no catalog tag", () => {
    expect(buildTrackEvent(lunaVega.pubkey, base).tags.some((t) => t[0] === "catalog")).toBe(false);
    expect(
      buildTrackEvent(lunaVega.pubkey, { ...base, inCatalog: true }).tags.some((t) => t[0] === "catalog"),
    ).toBe(false);
  });

  it("round-trips parse → build → parse (the edit-modal path) without re-listing the clip", () => {
    const original = parseTrackEvent(makeEvent([["catalog", "none"], ["genre", "Ambient"]]));
    expect(original.inCatalog).toBe(false);

    // What EditTrackModal / ReplaceAudioModal / MoveTrackModal do: rebuild from
    // parsed fields, threading inCatalog through.
    const rebuilt = buildTrackEvent(lunaVega.pubkey, {
      title: original.title,
      artist: original.artist,
      slug: original.addressableId.split(":").slice(2).join(":"),
      genre: original.genre,
      audioUrl: original.variants[0].url,
      visibility: original.visibility,
      sharingDisabled: original.sharingDisabled,
      inCatalog: original.inCatalog,
    });
    const reparsed = parseTrackEvent({ ...rebuilt, id: "evt-2", sig: "0".repeat(128) });

    expect(reparsed.inCatalog).toBe(false);
    expect(reparsed.visibility).toBe("public");
    expect(reparsed.addressableId).toBe(original.addressableId);
  });
});

// ─── selectors ──────────────────────────────────────

function track(over: Partial<MusicTrack> & { addressableId: string; pubkey: string }): MusicTrack {
  return {
    eventId: "evt-" + over.addressableId,
    title: over.addressableId,
    artist: "Artist",
    artistPubkeys: [],
    featuredArtists: [],
    collaborators: [],
    hashtags: [],
    variants: [],
    createdAt: 1000,
    visibility: "public",
    spaceIds: [],
    inCatalog: true,
    ...over,
  };
}

const listedId = `31683:${lunaVega.pubkey}:listed`;
const clipId = `31683:${lunaVega.pubkey}:clip`;
const featuredId = `31683:${felixMoreau.pubkey}:felix-track`;

function storeWithLunasTracks(viewer: string | null, savedTrackIds: string[] = []) {
  return createTestStore({
    identity: { pubkey: viewer } as any,
    music: {
      tracks: {
        [listedId]: track({ addressableId: listedId, pubkey: lunaVega.pubkey, createdAt: 3 }),
        [clipId]: track({
          addressableId: clipId,
          pubkey: lunaVega.pubkey,
          createdAt: 2,
          inCatalog: false,
        }),
        // Felix's LISTED track on which Luna is merely featured — Luna's
        // listing choices on her own clips must not touch it.
        [featuredId]: track({
          addressableId: featuredId,
          pubkey: felixMoreau.pubkey,
          featuredArtists: [lunaVega.pubkey],
          createdAt: 1,
        }),
      },
      tracksByArtist: { [lunaVega.pubkey]: [listedId, clipId] },
      library: { savedTrackIds, savedAlbumIds: [], favoritedTrackIds: [], favoritedAlbumIds: [], userPlaylists: [] },
    } as any,
  });
}

describe("musicSelectors catalog listing", () => {
  it("selectProfileTracks hides the owner's own unlisted clip from other viewers", () => {
    const store = storeWithLunasTracks(felixMoreau.pubkey);
    const ids = selectProfileTracks(lunaVega.pubkey)(store.getState()).map((t) => t.addressableId);
    expect(ids).toEqual([listedId, featuredId]);
  });

  it("selectProfileTracks hides it from the owner too (My Music is the re-list surface)", () => {
    const store = storeWithLunasTracks(lunaVega.pubkey);
    const ids = selectProfileTracks(lunaVega.pubkey)(store.getState()).map((t) => t.addressableId);
    expect(ids).not.toContain(clipId);
    expect(ids).toContain(listedId);
  });

  it("selectLibraryTracks excludes the viewer's own unlisted clip, even if it was saved", () => {
    const store = storeWithLunasTracks(lunaVega.pubkey, [clipId]);
    const ids = selectLibraryTracks(lunaVega.pubkey)(store.getState()).map((t) => t.addressableId);
    expect(ids).toEqual([listedId]);
  });

  it("selectMyTracks KEEPS the unlisted clip and exposes inCatalog for the label", () => {
    const store = storeWithLunasTracks(lunaVega.pubkey);
    const mine = selectMyTracks(lunaVega.pubkey)(store.getState());
    expect(mine.map((t) => t.addressableId)).toEqual([listedId, clipId]);
    expect(mine.find((t) => t.addressableId === clipId)?.inCatalog).toBe(false);
  });
});
