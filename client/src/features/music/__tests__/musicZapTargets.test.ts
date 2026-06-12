import { describe, it, expect } from "vitest";
import { getZappableArtists, getZapTargets } from "../musicZapTargets";

const A = "a".repeat(64); // primary artist pubkey
const B = "b".repeat(64); // featured artist pubkey
const C = "c".repeat(64); // another featured artist pubkey
const U = "d".repeat(64); // uploader (publisher) pubkey

describe("getZappableArtists", () => {
  it("returns the single explicit artist as primary", () => {
    const result = getZappableArtists({
      artist: "Luna",
      artistPubkeys: [A],
      featuredArtists: [],
    });
    expect(result).toEqual([{ pubkey: A, role: "primary" }]);
  });

  it("orders primary first, then featured artists", () => {
    const result = getZappableArtists({
      artist: "Luna",
      artistPubkeys: [A],
      featuredArtists: [B, C],
    });
    expect(result).toEqual([
      { pubkey: A, role: "primary" },
      { pubkey: B, role: "featured" },
      { pubkey: C, role: "featured" },
    ]);
  });

  it("treats a hex-pubkey artist field as the primary when no artist p-tag exists", () => {
    const result = getZappableArtists({
      artist: A,
      artistPubkeys: [],
      featuredArtists: [B],
    });
    expect(result).toEqual([
      { pubkey: A, role: "primary" },
      { pubkey: B, role: "featured" },
    ]);
  });

  it("de-duplicates a featured artist that is also the primary", () => {
    const result = getZappableArtists({
      artist: "Luna",
      artistPubkeys: [A],
      featuredArtists: [A, B],
    });
    expect(result).toEqual([
      { pubkey: A, role: "primary" },
      { pubkey: B, role: "featured" },
    ]);
  });

  it("returns [] for a name-only item with no linked pubkeys", () => {
    const result = getZappableArtists({
      artist: "Some Indie Band",
      artistPubkeys: [],
      featuredArtists: [],
    });
    expect(result).toEqual([]);
  });
});

describe("getZapTargets", () => {
  it("appends the uploader when they aren't a credited artist", () => {
    const result = getZapTargets({
      pubkey: U,
      artist: "Luna",
      artistPubkeys: [A],
      featuredArtists: [B],
    });
    expect(result).toEqual([
      { pubkey: A, role: "primary" },
      { pubkey: B, role: "featured" },
      { pubkey: U, role: "uploader" },
    ]);
  });

  it("does not duplicate the uploader when they are the primary artist", () => {
    const result = getZapTargets({
      pubkey: A,
      artist: "Luna",
      artistPubkeys: [A],
      featuredArtists: [B],
    });
    expect(result).toEqual([
      { pubkey: A, role: "primary" },
      { pubkey: B, role: "featured" },
    ]);
  });

  it("does not duplicate the uploader when they are a featured artist", () => {
    const result = getZapTargets({
      pubkey: B,
      artist: "Luna",
      artistPubkeys: [A],
      featuredArtists: [B],
    });
    expect(result).toEqual([
      { pubkey: A, role: "primary" },
      { pubkey: B, role: "featured" },
    ]);
  });

  it("falls back to a single uploader target for a name-only item", () => {
    const result = getZapTargets({
      pubkey: U,
      artist: "Some Indie Band",
      artistPubkeys: [],
      featuredArtists: [],
    });
    expect(result).toEqual([{ pubkey: U, role: "uploader" }]);
  });
});
