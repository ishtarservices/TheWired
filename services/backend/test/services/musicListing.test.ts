import { describe, it, expect } from "vitest";
import { CATALOG_TAG, isUnlisted, isListedPublicMusic } from "../../src/services/musicVisibility.js";
import { MS_LISTED_FILTER, isIndexableMusic, isMovedStub } from "../../src/lib/musicListing.js";
import { buildMusicSearchDoc } from "../../src/lib/musicSearchDoc.js";

/**
 * `["catalog","none"]` marks a real, public, playable track its author keeps
 * off their catalog (mobile "audio attached to a note"). It is not a
 * visibility state — it only removes the track from public discovery surfaces
 * and author shelves. docs/MUSIC_VISIBILITY.md §"Catalog listing".
 */

const base: string[][] = [["d", "clip"], ["title", "Clip"]];

describe("isUnlisted", () => {
  it("is true only for the exact catalog:none tag", () => {
    expect(CATALOG_TAG).toBe("catalog");
    expect(isUnlisted([...base, ["catalog", "none"]])).toBe(true);
    expect(isUnlisted(base)).toBe(false);
    expect(isUnlisted([...base, ["catalog", "other"]])).toBe(false);
    expect(isUnlisted([...base, ["catalog"]])).toBe(false);
  });
});

describe("isListedPublicMusic", () => {
  it("accepts a plain public track", () => {
    expect(isListedPublicMusic(base)).toBe(true);
  });

  it("rejects every visibility tag value", () => {
    expect(isListedPublicMusic([...base, ["visibility", "private"]])).toBe(false);
    expect(isListedPublicMusic([...base, ["visibility", "unlisted"]])).toBe(false);
    expect(isListedPublicMusic([...base, ["visibility", "anything"]])).toBe(false);
  });

  it("rejects space-scoped (h-tagged) tracks", () => {
    expect(isListedPublicMusic([...base, ["h", "some-space"]])).toBe(false);
  });

  it("rejects catalog:none but not other catalog values", () => {
    expect(isListedPublicMusic([...base, ["catalog", "none"]])).toBe(false);
    expect(isListedPublicMusic([...base, ["catalog", "featured"]])).toBe(true);
  });

  it("rejects a shared project's moved stub", () => {
    expect(isListedPublicMusic([...base, ["moved", "31683:k2:clip"]])).toBe(false);
  });

  it("matches the Meilisearch clause used by browse/search", () => {
    // Legacy docs indexed before `unlisted` existed have no attribute; the
    // clause is a NOT so they keep matching (verified on Meilisearch 1.6.2).
    expect(MS_LISTED_FILTER).toBe("NOT unlisted = true");
  });
});

describe("buildMusicSearchDoc catalog listing", () => {
  const ev = (tags: string[][]) => ({ id: "e1", pubkey: "p1", created_at: 1, tags });

  it("marks catalog:none tracks unlisted so browse/search can filter them at query time", () => {
    expect(buildMusicSearchDoc(ev([...base, ["catalog", "none"]]), 31683).unlisted).toBe(true);
  });

  it("marks ordinary tracks and every album listed", () => {
    expect(buildMusicSearchDoc(ev(base), 31683).unlisted).toBe(false);
    expect(buildMusicSearchDoc(ev(base), 33123).unlisted).toBe(false);
  });
});

describe("isMovedStub", () => {
  it("is true only for a valued moved tag", () => {
    expect(isMovedStub([...base, ["moved", "33123:k2:clip"]])).toBe(true);
    expect(isMovedStub([...base, ["moved"]])).toBe(false);
    expect(isMovedStub(base)).toBe(false);
  });
});

describe("isIndexableMusic", () => {
  it("indexes public tracks, unlisted ones included", () => {
    expect(isIndexableMusic(base)).toBe(true);
    expect(isIndexableMusic([...base, ["catalog", "none"]])).toBe(true);
  });

  it("never indexes protected versions or moved stubs", () => {
    expect(isIndexableMusic([...base, ["visibility", "private"]])).toBe(false);
    expect(isIndexableMusic([...base, ["h", "some-space"]])).toBe(false);
    expect(isIndexableMusic([...base, ["moved", "31683:k2:clip"]])).toBe(false);
  });

  it("reads the protected shape by value, like ingest and the relay", () => {
    // A value-less leading tag must not mask a later real one.
    expect(isIndexableMusic([...base, ["h"], ["h", "some-space"]])).toBe(false);
    expect(isIndexableMusic([...base, ["h"]])).toBe(true);
  });
});
