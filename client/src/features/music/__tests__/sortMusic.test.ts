import { describe, it, expect } from "vitest";
import type { MusicTrack, MusicAlbum } from "@/types/music";
import {
  sortTracks,
  sortAlbums,
  filterTracks,
  filterAlbums,
  defaultDir,
  flipDir,
} from "../sortMusic";

// ─── factories ──────────────────────────────────────

function track(over: Partial<MusicTrack> = {}): MusicTrack {
  return {
    addressableId: over.addressableId ?? `31683:pk:${over.title ?? "t"}`,
    eventId: "evt",
    pubkey: "pk",
    title: "Title",
    artist: "Artist",
    artistPubkeys: [],
    featuredArtists: [],
    collaborators: [],
    hashtags: [],
    variants: [],
    createdAt: 1000,
    visibility: "public",
    ...over,
  };
}

function album(over: Partial<MusicAlbum> = {}): MusicAlbum {
  return {
    addressableId: over.addressableId ?? `33123:pk:${over.title ?? "a"}`,
    eventId: "evt",
    pubkey: "pk",
    title: "Title",
    artist: "Artist",
    artistPubkeys: [],
    featuredArtists: [],
    collaborators: [],
    projectType: "album",
    trackRefs: [],
    hashtags: [],
    trackCount: 0,
    createdAt: 1000,
    visibility: "public",
    ...over,
  };
}

const titles = (ts: { title: string }[]) => ts.map((t) => t.title);

// ─── direction helpers ──────────────────────────────

describe("defaultDir / flipDir", () => {
  it("defaults text + duration ascending, time-like keys descending", () => {
    expect(defaultDir("title")).toBe("asc");
    expect(defaultDir("artist")).toBe("asc");
    expect(defaultDir("genre")).toBe("asc");
    expect(defaultDir("duration")).toBe("asc");
    expect(defaultDir("added")).toBe("desc");
    expect(defaultDir("released")).toBe("desc");
    expect(defaultDir("tracks")).toBe("desc");
  });

  it("flips direction", () => {
    expect(flipDir("asc")).toBe("desc");
    expect(flipDir("desc")).toBe("asc");
  });
});

// ─── sortTracks ─────────────────────────────────────

describe("sortTracks", () => {
  const a = track({ title: "Bravo", artist: "Zeta", genre: "Rock", duration: 200, createdAt: 30 });
  const b = track({ title: "alpha", artist: "Mike", genre: "Ambient", duration: 100, createdAt: 10 });
  const c = track({ title: "Charlie", artist: "Anna", genre: "House", duration: 300, createdAt: 20 });
  const list = [a, b, c];

  it("'added' desc is identity; asc reverses", () => {
    expect(sortTracks(list, "added", "desc")).toEqual(list);
    expect(sortTracks(list, "added", "asc")).toEqual([c, b, a]);
    // returns a new array (does not mutate input)
    expect(sortTracks(list, "added", "desc")).not.toBe(list);
  });

  it("sorts by title case-insensitively (asc/desc)", () => {
    expect(titles(sortTracks(list, "title", "asc"))).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(titles(sortTracks(list, "title", "desc"))).toEqual(["Charlie", "Bravo", "alpha"]);
  });

  it("uses numeric-aware collation (Track 2 before Track 10)", () => {
    const t2 = track({ title: "Track 2" });
    const t10 = track({ title: "Track 10" });
    expect(titles(sortTracks([t10, t2], "title", "asc"))).toEqual(["Track 2", "Track 10"]);
  });

  it("sorts by artist, duration, and released date", () => {
    expect(sortTracks(list, "artist", "asc").map((t) => t.artist)).toEqual(["Anna", "Mike", "Zeta"]);
    expect(sortTracks(list, "duration", "asc").map((t) => t.duration)).toEqual([100, 200, 300]);
    expect(sortTracks(list, "released", "desc").map((t) => t.createdAt)).toEqual([30, 20, 10]);
  });

  it("sorts tracks with missing genre/duration to the end regardless of direction", () => {
    const withGenre = track({ title: "has", genre: "Jazz" });
    const noGenre = track({ title: "none", genre: undefined });
    expect(titles(sortTracks([noGenre, withGenre], "genre", "asc"))).toEqual(["has", "none"]);
    expect(titles(sortTracks([noGenre, withGenre], "genre", "desc"))).toEqual(["has", "none"]);

    const withDur = track({ title: "dur", duration: 5 });
    const noDur = track({ title: "nodur", duration: undefined });
    expect(titles(sortTracks([noDur, withDur], "duration", "asc"))).toEqual(["dur", "nodur"]);
    expect(titles(sortTracks([noDur, withDur], "duration", "desc"))).toEqual(["dur", "nodur"]);
  });
});

// ─── sortAlbums ─────────────────────────────────────

describe("sortAlbums", () => {
  const a = album({ title: "Beta", trackCount: 5, createdAt: 30 });
  const b = album({ title: "alpha", trackCount: 12, createdAt: 10 });
  const list = [a, b];

  it("sorts by title and track count", () => {
    expect(sortAlbums(list, "title", "asc").map((x) => x.title)).toEqual(["alpha", "Beta"]);
    expect(sortAlbums(list, "tracks", "desc").map((x) => x.trackCount)).toEqual([12, 5]);
  });

  it("'added' desc is identity", () => {
    expect(sortAlbums(list, "added", "desc")).toEqual(list);
  });
});

// ─── filters ────────────────────────────────────────

describe("filterTracks / filterAlbums", () => {
  const ts = [
    track({ title: "Midnight", artist: "Luna" }),
    track({ title: "Sunrise", artist: "Felix" }),
  ];

  it("matches title or artist case-insensitively", () => {
    expect(titles(filterTracks(ts, "mid"))).toEqual(["Midnight"]);
    expect(titles(filterTracks(ts, "FELIX"))).toEqual(["Sunrise"]);
  });

  it("returns input unchanged for empty/whitespace query", () => {
    expect(filterTracks(ts, "")).toBe(ts);
    expect(filterTracks(ts, "   ")).toBe(ts);
  });

  it("filters albums by title/artist", () => {
    const as = [album({ title: "Nightfall", artist: "Anna" })];
    expect(filterAlbums(as, "night")).toHaveLength(1);
    expect(filterAlbums(as, "zzz")).toHaveLength(0);
  });
});
