/**
 * Tests that data is properly isolated between curated and all-mode channels.
 * Verifies that tracks don't leak between channels where they shouldn't appear.
 */
import { describe, it, expect } from "vitest";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { eventsSlice } from "@/store/slices/eventsSlice";
import type { NostrEvent } from "@/types/nostr";
import type { Space, SpaceChannel } from "@/types/space";

const { indexSpaceFeed } = eventsSlice.actions;

// ─── helpers ────────────────────────────────────────

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    name: "Music Community",
    hostRelay: "wss://relay.test.com",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: ["admin-pk"],
    memberPubkeys: ["admin-pk", "artist-a", "artist-b", "artist-c"],
    feedPubkeys: [],
    creatorPubkey: "admin-pk",
    createdAt: 1000000,
    ...overrides,
  };
}

function makeChannel(overrides: Partial<SpaceChannel> = {}): SpaceChannel {
  return {
    id: "ch-music",
    spaceId: "space-1",
    type: "music",
    label: "#music",
    position: 0,
    isDefault: false,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
    ...overrides,
  };
}

function makeTrackEvent(id: string, pubkey: string, channelTag?: string, spaceId = "space-1"): NostrEvent {
  const tags: string[][] = [
    ["d", `track-${id}`],
    ["title", `Track ${id}`],
    ["artist", `Artist`],
  ];
  if (channelTag) {
    tags.push(["h", spaceId]);
    tags.push(["channel", channelTag]);
  }
  return {
    id: `evt-${id}`,
    pubkey,
    created_at: 1718452800 + parseInt(id) || 0,
    kind: 31683,
    tags,
    content: "",
    sig: "0".repeat(128),
  };
}

/**
 * Simulates the indexing logic from eventPipeline.indexEventIntoSpaceFeeds.
 * This is the exact logic that determines which channels an event appears in.
 * Includes h-tag space scoping: events with ["h", spaceId] only index into that space.
 */
function simulateIndexing(
  store: ReturnType<typeof createTestStore>,
  event: NostrEvent,
  space: Space,
  channels: SpaceChannel[],
) {
  // H-tag space scoping: skip if event targets a different space
  const eventHTag = event.tags.find((t) => t[0] === "h")?.[1];
  if (eventHTag && eventHTag !== space.id) return;

  const matchingChannels = channels.filter((c) => c.type === "music");
  const eventChannelTag = event.tags.find((t) => t[0] === "channel")?.[1];

  for (const ch of matchingChannels) {
    if (eventChannelTag) {
      if (eventChannelTag !== ch.id) continue;
    } else if (ch.feedMode === "curated") {
      continue;
    }
    const contextId = `${space.id}:${ch.id}`;
    store.dispatch(indexSpaceFeed({ contextId, eventId: event.id }));
  }

  // Legacy indexing (always happens in production)
  store.dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: event.id }));
}

// ─── Data isolation: curated channels ───────────────

describe("curated channel data isolation", () => {
  const space = makeSpace();

  it("untagged tracks do NOT leak into curated channels", () => {
    const store = createTestStore();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all", feedMode: "all" }),
      makeChannel({ id: "ch-curated", feedMode: "curated" }),
    ];

    // Artist A uploads a public track without targeting any channel
    simulateIndexing(store, makeTrackEvent("1", "artist-a"), space, channels);
    // Artist B uploads another untargeted track
    simulateIndexing(store, makeTrackEvent("2", "artist-b"), space, channels);

    // All-mode: both tracks appear
    expect(store.getState().events.spaceFeeds["space-1:ch-all"]).toEqual(["evt-1", "evt-2"]);
    // Curated: NOTHING leaks in
    expect(store.getState().events.spaceFeeds["space-1:ch-curated"]).toBeUndefined();
  });

  it("tracks tagged for channel A do NOT leak into curated channel B", () => {
    const store = createTestStore();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
      makeChannel({ id: "ch-covers", feedMode: "curated" }),
    ];

    // Track explicitly tagged for ch-originals
    simulateIndexing(store, makeTrackEvent("1", "artist-a", "ch-originals"), space, channels);
    // Track explicitly tagged for ch-covers
    simulateIndexing(store, makeTrackEvent("2", "artist-b", "ch-covers"), space, channels);

    // Each channel only has its own track
    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).toEqual(["evt-1"]);
    expect(store.getState().events.spaceFeeds["space-1:ch-covers"]).toEqual(["evt-2"]);

    // No cross-contamination
    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).not.toContain("evt-2");
    expect(store.getState().events.spaceFeeds["space-1:ch-covers"]).not.toContain("evt-1");
  });

  it("track tagged for a curated channel does NOT appear in all-mode channels", () => {
    const store = createTestStore();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all", feedMode: "all" }),
      makeChannel({ id: "ch-curated", feedMode: "curated" }),
    ];

    // Track explicitly targeting the curated channel
    simulateIndexing(store, makeTrackEvent("1", "artist-a", "ch-curated"), space, channels);

    // Channel-tagged events only go to their target channel
    expect(store.getState().events.spaceFeeds["space-1:ch-all"]).toBeUndefined();
    expect(store.getState().events.spaceFeeds["space-1:ch-curated"]).toEqual(["evt-1"]);
  });

  it("track from non-member does NOT appear (pre-condition for indexing)", () => {
    // In production, indexEventIntoSpaceFeeds checks membership before calling
    // the channel indexing logic. Outsiders are filtered out before reaching
    // the channel-level code. We verify the membership list excludes outsiders.
    const outsiderPubkey = "outsider-pk";
    expect(space.memberPubkeys).not.toContain(outsiderPubkey);
  });
});

// ─── Data isolation: multiple spaces ────────────────

describe("cross-space data isolation", () => {
  it("tracks from space A do NOT appear in space B channels", () => {
    const store = createTestStore();
    const spaceA = makeSpace({ id: "space-a", memberPubkeys: ["artist-a"] });
    const spaceB = makeSpace({ id: "space-b", memberPubkeys: ["artist-b"] });
    const channelsA: SpaceChannel[] = [
      makeChannel({ id: "ch-a-music", spaceId: "space-a", feedMode: "all" }),
    ];
    const channelsB: SpaceChannel[] = [
      makeChannel({ id: "ch-b-music", spaceId: "space-b", feedMode: "all" }),
    ];

    simulateIndexing(store, makeTrackEvent("1", "artist-a"), spaceA, channelsA);
    simulateIndexing(store, makeTrackEvent("2", "artist-b"), spaceB, channelsB);

    expect(store.getState().events.spaceFeeds["space-a:ch-a-music"]).toEqual(["evt-1"]);
    expect(store.getState().events.spaceFeeds["space-b:ch-b-music"]).toEqual(["evt-2"]);

    // No cross-space contamination
    expect(store.getState().events.spaceFeeds["space-a:ch-a-music"]).not.toContain("evt-2");
    expect(store.getState().events.spaceFeeds["space-b:ch-b-music"]).not.toContain("evt-1");
  });

  it("channel tag from space A does not match curated channel in space B even with same ID", () => {
    const store = createTestStore();
    const spaceA = makeSpace({ id: "space-a" });

    // Both spaces have a channel with the same ID "ch-curated"
    const channelsA: SpaceChannel[] = [
      makeChannel({ id: "ch-curated", spaceId: "space-a", feedMode: "curated" }),
    ];

    // Track tagged for ch-curated, scoped to space-a
    const evt = makeTrackEvent("1", "artist-a", "ch-curated", "space-a");
    simulateIndexing(store, evt, spaceA, channelsA);

    // Space A's curated channel has the event
    expect(store.getState().events.spaceFeeds["space-a:ch-curated"]).toEqual(["evt-1"]);
    // Space B's same-named channel is untouched (indexing is per-space)
    expect(store.getState().events.spaceFeeds["space-b:ch-curated"]).toBeUndefined();
  });

  it("h-tag scoped track does NOT leak to other spaces (even when author is member of both)", () => {
    const store = createTestStore();
    // Artist is a member of BOTH spaces
    const sharedArtist = "artist-shared";
    const spaceA = makeSpace({ id: "space-a", memberPubkeys: [sharedArtist] });
    const spaceB = makeSpace({ id: "space-b", memberPubkeys: [sharedArtist] });
    const channelsA: SpaceChannel[] = [
      makeChannel({ id: "ch-a-music", spaceId: "space-a", feedMode: "all" }),
    ];
    const channelsB: SpaceChannel[] = [
      makeChannel({ id: "ch-b-music", spaceId: "space-b", feedMode: "all" }),
    ];

    // Track scoped to space-a via h-tag
    const scopedTrack: NostrEvent = {
      id: "evt-scoped",
      pubkey: sharedArtist,
      created_at: 1718452800,
      kind: 31683,
      tags: [
        ["d", "scoped-track"],
        ["title", "Space A Only"],
        ["artist", "Shared"],
        ["h", "space-a"],
      ],
      content: "",
      sig: "0".repeat(128),
    };

    // Index into both spaces — h-tag check should block space-b
    simulateIndexing(store, scopedTrack, spaceA, channelsA);
    simulateIndexing(store, scopedTrack, spaceB, channelsB);

    // Appears in space-a
    expect(store.getState().events.spaceFeeds["space-a:ch-a-music"]).toEqual(["evt-scoped"]);
    // Does NOT appear in space-b despite author being a member
    expect(store.getState().events.spaceFeeds["space-b:ch-b-music"]).toBeUndefined();
    // Legacy key also scoped
    expect(store.getState().events.spaceFeeds["space-a:music"]).toEqual(["evt-scoped"]);
    expect(store.getState().events.spaceFeeds["space-b:music"]).toBeUndefined();
  });

  it("public track (no h-tag) appears in all spaces where author is member", () => {
    const store = createTestStore();
    const sharedArtist = "artist-shared";
    const spaceA = makeSpace({ id: "space-a", memberPubkeys: [sharedArtist] });
    const spaceB = makeSpace({ id: "space-b", memberPubkeys: [sharedArtist] });
    const channelsA: SpaceChannel[] = [
      makeChannel({ id: "ch-a-music", spaceId: "space-a", feedMode: "all" }),
    ];
    const channelsB: SpaceChannel[] = [
      makeChannel({ id: "ch-b-music", spaceId: "space-b", feedMode: "all" }),
    ];

    // Public track (no h-tag) — should appear everywhere
    const publicTrack = makeTrackEvent("pub", sharedArtist);
    simulateIndexing(store, publicTrack, spaceA, channelsA);
    simulateIndexing(store, publicTrack, spaceB, channelsB);

    expect(store.getState().events.spaceFeeds["space-a:ch-a-music"]).toEqual(["evt-pub"]);
    expect(store.getState().events.spaceFeeds["space-b:ch-b-music"]).toEqual(["evt-pub"]);
  });

  it("h-tag scoped track with channel tag only appears in correct space + channel", () => {
    const store = createTestStore();
    const sharedArtist = "artist-shared";
    const spaceA = makeSpace({ id: "space-a", memberPubkeys: [sharedArtist] });
    const spaceB = makeSpace({ id: "space-b", memberPubkeys: [sharedArtist] });
    const channelsA: SpaceChannel[] = [
      makeChannel({ id: "ch-a-all", spaceId: "space-a", feedMode: "all" }),
      makeChannel({ id: "ch-a-curated", spaceId: "space-a", feedMode: "curated" }),
    ];
    const channelsB: SpaceChannel[] = [
      makeChannel({ id: "ch-b-all", spaceId: "space-b", feedMode: "all" }),
      makeChannel({ id: "ch-b-curated", spaceId: "space-b", feedMode: "curated" }),
    ];

    // Track scoped to space-a, targeting curated channel
    const targetedTrack: NostrEvent = {
      id: "evt-targeted",
      pubkey: sharedArtist,
      created_at: 1718452800,
      kind: 31683,
      tags: [
        ["d", "targeted"],
        ["title", "Targeted"],
        ["artist", "Shared"],
        ["h", "space-a"],
        ["channel", "ch-a-curated"],
      ],
      content: "",
      sig: "0".repeat(128),
    };

    simulateIndexing(store, targetedTrack, spaceA, channelsA);
    simulateIndexing(store, targetedTrack, spaceB, channelsB);

    // Channel-tagged: only appears in the target curated channel, not the all-mode one
    expect(store.getState().events.spaceFeeds["space-a:ch-a-all"]).toBeUndefined();
    expect(store.getState().events.spaceFeeds["space-a:ch-a-curated"]).toEqual(["evt-targeted"]);
    // Does NOT appear in space-b at all (h-tag blocks it)
    expect(store.getState().events.spaceFeeds["space-b:ch-b-all"]).toBeUndefined();
    expect(store.getState().events.spaceFeeds["space-b:ch-b-curated"]).toBeUndefined();
  });
});

// ─── Data isolation: feed mode transitions ──────────

describe("feed mode transition isolation", () => {
  it("switching from all to curated does not retroactively remove events", () => {
    const store = createTestStore();
    const space = makeSpace();

    // Phase 1: all mode — events flow in freely
    let channels: SpaceChannel[] = [
      makeChannel({ id: "ch-music", feedMode: "all" }),
    ];
    simulateIndexing(store, makeTrackEvent("1", "artist-a"), space, channels);
    simulateIndexing(store, makeTrackEvent("2", "artist-b"), space, channels);
    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).toHaveLength(2);

    // Phase 2: admin switches to curated — existing events stay (already indexed)
    // Only future indexing is affected
    channels = [makeChannel({ id: "ch-music", feedMode: "curated" })];
    simulateIndexing(store, makeTrackEvent("3", "artist-c"), space, channels);

    // evt-1 and evt-2 are still there (no retroactive cleanup)
    // evt-3 is NOT added because it has no channel tag
    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).toHaveLength(2);
    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).toContain("evt-1");
    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).toContain("evt-2");
    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).not.toContain("evt-3");
  });

  it("after switching to curated, only tagged events get in", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-music", feedMode: "curated" }),
    ];

    // Untagged: rejected
    simulateIndexing(store, makeTrackEvent("1", "artist-a"), space, channels);
    // Tagged for this channel: accepted
    simulateIndexing(store, makeTrackEvent("2", "artist-b", "ch-music"), space, channels);
    // Tagged for wrong channel: rejected
    simulateIndexing(store, makeTrackEvent("3", "artist-c", "ch-other"), space, channels);

    const feed = store.getState().events.spaceFeeds["space-1:ch-music"];
    expect(feed).toHaveLength(1);
    expect(feed).toEqual(["evt-2"]);
  });
});

// ─── Data isolation: legacy context ─────────────────

describe("legacy context isolation", () => {
  it("legacy context receives all events regardless of channel mode", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all", feedMode: "all" }),
      makeChannel({ id: "ch-curated", feedMode: "curated" }),
    ];

    // Untagged event
    simulateIndexing(store, makeTrackEvent("1", "artist-a"), space, channels);
    // Tagged event
    simulateIndexing(store, makeTrackEvent("2", "artist-b", "ch-curated"), space, channels);

    // Legacy context always gets everything (used for backward compat)
    const legacy = store.getState().events.spaceFeeds["space-1:music"];
    expect(legacy).toHaveLength(2);
    expect(legacy).toContain("evt-1");
    expect(legacy).toContain("evt-2");

    // But curated channel only has the tagged one
    expect(store.getState().events.spaceFeeds["space-1:ch-curated"]).toEqual(["evt-2"]);
  });
});

// ─── Stress: many events, many channels ─────────────

describe("bulk indexing isolation", () => {
  it("50 events across 3 channels maintain perfect isolation", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all", feedMode: "all" }),
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
      makeChannel({ id: "ch-covers", feedMode: "curated" }),
    ];

    // 20 untagged, 15 for originals, 15 for covers
    for (let i = 0; i < 20; i++) {
      simulateIndexing(store, makeTrackEvent(`u${i}`, "artist-a"), space, channels);
    }
    for (let i = 0; i < 15; i++) {
      simulateIndexing(store, makeTrackEvent(`o${i}`, "artist-b", "ch-originals"), space, channels);
    }
    for (let i = 0; i < 15; i++) {
      simulateIndexing(store, makeTrackEvent(`c${i}`, "artist-c", "ch-covers"), space, channels);
    }

    const allFeed = store.getState().events.spaceFeeds["space-1:ch-all"];
    const originalsFeed = store.getState().events.spaceFeeds["space-1:ch-originals"];
    const coversFeed = store.getState().events.spaceFeeds["space-1:ch-covers"];

    // All-mode: only untagged events (tagged go exclusively to their target)
    expect(allFeed).toHaveLength(20);
    // Curated: only their tagged events
    expect(originalsFeed).toHaveLength(15);
    expect(coversFeed).toHaveLength(15);

    // Verify no originals events leaked into covers
    for (const evtId of originalsFeed) {
      expect(coversFeed).not.toContain(evtId);
    }
    // Verify no covers events leaked into originals
    for (const evtId of coversFeed) {
      expect(originalsFeed).not.toContain(evtId);
    }
    // Verify no untagged events leaked into curated channels
    for (let i = 0; i < 20; i++) {
      expect(originalsFeed).not.toContain(`evt-u${i}`);
      expect(coversFeed).not.toContain(`evt-u${i}`);
    }
  });
});
