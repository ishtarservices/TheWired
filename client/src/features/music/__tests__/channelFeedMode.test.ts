import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildTrackEvent, buildAlbumEvent } from "../musicEventBuilder";
import { lunaVega } from "@/__tests__/fixtures/testUsers";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
});

// ─── helpers ────────────────────────────────────────

const BASE_TRACK_PARAMS = {
  title: "Test Track",
  artist: "Luna",
  slug: "test-track",
  audioUrl: "https://example.com/audio.mp3",
};

const BASE_ALBUM_PARAMS = {
  title: "Test Album",
  artist: "Luna",
  slug: "test-album",
};

// ─── buildTrackEvent: channel tag ────────────────────

describe("buildTrackEvent channel targeting", () => {
  it("adds no channel tag for public visibility", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "public",
      channelId: "ch-music-curated",
    });
    expect(event.tags.some((t) => t[0] === "channel")).toBe(false);
    expect(event.tags.some((t) => t[0] === "h")).toBe(false);
  });

  it("adds channel tag alongside h-tag for space visibility", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "space",
      spaceId: "space-123",
      channelId: "ch-music-curated",
    });
    expect(event.tags).toContainEqual(["h", "space-123"]);
    expect(event.tags).toContainEqual(["channel", "ch-music-curated"]);
  });

  it("adds h-tag without channel tag when channelId is undefined", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "space",
      spaceId: "space-123",
    });
    expect(event.tags).toContainEqual(["h", "space-123"]);
    expect(event.tags.some((t) => t[0] === "channel")).toBe(false);
  });

  it("omits channel tag when spaceId is missing (even if channelId set)", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "space",
      channelId: "ch-music-curated",
      // no spaceId
    });
    // Without spaceId, the "space" visibility path is skipped entirely
    expect(event.tags.some((t) => t[0] === "h")).toBe(false);
    expect(event.tags.some((t) => t[0] === "channel")).toBe(false);
  });

  it("does not add channel tag for private visibility", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "private",
      channelId: "ch-music-curated",
    });
    expect(event.tags).toContainEqual(["visibility", "private"]);
    expect(event.tags.some((t) => t[0] === "channel")).toBe(false);
    expect(event.tags.some((t) => t[0] === "h")).toBe(false);
  });

  it("does not add channel tag for local visibility", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "local",
      channelId: "ch-music-curated",
    });
    expect(event.tags.some((t) => t[0] === "channel")).toBe(false);
  });
});

// ─── buildAlbumEvent: channel tag ────────────────────

describe("buildAlbumEvent channel targeting", () => {
  it("adds channel tag alongside h-tag for space visibility", () => {
    const event = buildAlbumEvent(lunaVega.pubkey, {
      ...BASE_ALBUM_PARAMS,
      visibility: "space",
      spaceId: "space-456",
      channelId: "ch-curated-albums",
    });
    expect(event.tags).toContainEqual(["h", "space-456"]);
    expect(event.tags).toContainEqual(["channel", "ch-curated-albums"]);
  });

  it("omits channel tag when channelId is empty string", () => {
    const event = buildAlbumEvent(lunaVega.pubkey, {
      ...BASE_ALBUM_PARAMS,
      visibility: "space",
      spaceId: "space-456",
      channelId: "",
    });
    expect(event.tags).toContainEqual(["h", "space-456"]);
    expect(event.tags.some((t) => t[0] === "channel")).toBe(false);
  });

  it("omits channel tag when not provided", () => {
    const event = buildAlbumEvent(lunaVega.pubkey, {
      ...BASE_ALBUM_PARAMS,
      visibility: "space",
      spaceId: "space-456",
    });
    expect(event.tags).toContainEqual(["h", "space-456"]);
    expect(event.tags.some((t) => t[0] === "channel")).toBe(false);
  });
});

// ─── Tag structure: channel tag is independent of h-tag ──

describe("channel and h-tag independence", () => {
  it("h-tag and channel tag appear as separate entries", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "space",
      spaceId: "space-789",
      channelId: "ch-originals",
    });

    const hTags = event.tags.filter((t) => t[0] === "h");
    const channelTags = event.tags.filter((t) => t[0] === "channel");

    expect(hTags).toHaveLength(1);
    expect(hTags[0]).toEqual(["h", "space-789"]);
    expect(channelTags).toHaveLength(1);
    expect(channelTags[0]).toEqual(["channel", "ch-originals"]);
  });

  it("multiple channel tags are not added for same channelId", () => {
    const event = buildTrackEvent(lunaVega.pubkey, {
      ...BASE_TRACK_PARAMS,
      visibility: "space",
      spaceId: "space-789",
      channelId: "ch-originals",
    });

    const channelTags = event.tags.filter((t) => t[0] === "channel");
    expect(channelTags).toHaveLength(1);
  });
});
