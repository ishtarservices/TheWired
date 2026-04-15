import { describe, it, expect } from "vitest";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { eventsSlice } from "@/store/slices/eventsSlice";
import { spacesSlice } from "@/store/slices/spacesSlice";
import type { NostrEvent } from "@/types/nostr";
import type { Space, SpaceChannel } from "@/types/space";

const { indexSpaceFeed } = eventsSlice.actions;
const { setChannels } = spacesSlice.actions;

// ─── helpers ────────────────────────────────────────

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    name: "Test Space",
    hostRelay: "wss://relay.test.com",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: ["member-a", "member-b"],
    feedPubkeys: [],
    creatorPubkey: "member-a",
    createdAt: 1000000,
    ...overrides,
  };
}

function makeChannel(overrides: Partial<SpaceChannel> = {}): SpaceChannel {
  return {
    id: "ch-all-music",
    spaceId: "space-1",
    type: "music",
    label: "#all-music",
    position: 0,
    isDefault: false,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
    ...overrides,
  };
}

function makeTrackEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    pubkey: "member-a",
    created_at: 1718452800,
    kind: 31683,
    tags: [
      ["d", "track-slug"],
      ["title", "Test Track"],
      ["artist", "Artist A"],
    ],
    content: "",
    sig: "0".repeat(128),
    ...overrides,
  };
}

// ─── indexSpaceFeed: basic channel indexing ──────────

describe("space feed indexing with channel IDs", () => {
  it("indexes event into a specific channel by ID", () => {
    const store = createTestStore();
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-music-1", eventId: "evt-1" }));
    expect(store.getState().events.spaceFeeds["space-1:ch-music-1"]).toEqual(["evt-1"]);
  });

  it("indexes same event into multiple channels independently", () => {
    const store = createTestStore();
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-all-music", eventId: "evt-1" }));
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-curated", eventId: "evt-1" }));
    store.dispatch(indexSpaceFeed({ contextId: "space-1:music", eventId: "evt-1" })); // legacy

    expect(store.getState().events.spaceFeeds["space-1:ch-all-music"]).toEqual(["evt-1"]);
    expect(store.getState().events.spaceFeeds["space-1:ch-curated"]).toEqual(["evt-1"]);
    expect(store.getState().events.spaceFeeds["space-1:music"]).toEqual(["evt-1"]);
  });

  it("does not cross-pollinate between channels", () => {
    const store = createTestStore();
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-all-music", eventId: "evt-1" }));
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-curated", eventId: "evt-2" }));

    expect(store.getState().events.spaceFeeds["space-1:ch-all-music"]).toEqual(["evt-1"]);
    expect(store.getState().events.spaceFeeds["space-1:ch-curated"]).toEqual(["evt-2"]);
  });
});

// ─── Channel feedMode: Redux state ──────────────────

describe("channel feedMode in Redux state", () => {
  it("stores feedMode on channels", () => {
    const store = createTestStore();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all", feedMode: "all" }),
      makeChannel({ id: "ch-curated", feedMode: "curated" }),
    ];
    store.dispatch(setChannels({ spaceId: "space-1", channels }));

    const stored = store.getState().spaces.channels["space-1"];
    expect(stored).toHaveLength(2);
    expect(stored[0].feedMode).toBe("all");
    expect(stored[1].feedMode).toBe("curated");
  });

  it("preserves feedMode when updating channel list", () => {
    const store = createTestStore();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-curated", feedMode: "curated" }),
    ];
    store.dispatch(setChannels({ spaceId: "space-1", channels }));

    // Simulate re-setting channels (e.g., from backend refresh)
    const refreshed: SpaceChannel[] = [
      makeChannel({ id: "ch-curated", feedMode: "curated", label: "#renamed" }),
    ];
    store.dispatch(setChannels({ spaceId: "space-1", channels: refreshed }));

    const stored = store.getState().spaces.channels["space-1"];
    expect(stored[0].feedMode).toBe("curated");
    expect(stored[0].label).toBe("#renamed");
  });
});

// ─── Multiple music channels per space ──────────────

describe("multiple music channels in Redux", () => {
  it("allows multiple music channels with different feedModes", () => {
    const store = createTestStore();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-chat", type: "chat", label: "#chat", position: 0 }),
      makeChannel({ id: "ch-all-music", type: "music", label: "#all-music", feedMode: "all", position: 1 }),
      makeChannel({ id: "ch-originals", type: "music", label: "#originals", feedMode: "curated", position: 2 }),
      makeChannel({ id: "ch-covers", type: "music", label: "#covers", feedMode: "curated", position: 3 }),
    ];
    store.dispatch(setChannels({ spaceId: "space-1", channels }));

    const stored = store.getState().spaces.channels["space-1"];
    const musicChannels = stored.filter((c) => c.type === "music");
    expect(musicChannels).toHaveLength(3);

    const allMode = musicChannels.filter((c) => c.feedMode === "all");
    const curatedMode = musicChannels.filter((c) => c.feedMode === "curated");
    expect(allMode).toHaveLength(1);
    expect(curatedMode).toHaveLength(2);
  });

  it("each music channel maintains independent feed state", () => {
    const store = createTestStore();

    // Index events into different music channels
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-all-music", eventId: "evt-1" }));
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-all-music", eventId: "evt-2" }));
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-originals", eventId: "evt-3" }));

    const allFeed = store.getState().events.spaceFeeds["space-1:ch-all-music"];
    const curatedFeed = store.getState().events.spaceFeeds["space-1:ch-originals"];

    expect(allFeed).toHaveLength(2);
    expect(allFeed).toContain("evt-1");
    expect(allFeed).toContain("evt-2");

    expect(curatedFeed).toHaveLength(1);
    expect(curatedFeed).toContain("evt-3");
  });
});

// ─── Curated filtering simulation ───────────────────
// These tests simulate the logic in eventPipeline.indexEventIntoSpaceFeeds
// without importing the actual function (which has module-level side effects).

describe("curated channel filtering logic", () => {
  /**
   * Simulates the indexing logic from eventPipeline.indexEventIntoSpaceFeeds
   * for a single space + event combination.
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

    const channelType = "music";
    const matchingChannels = channels.filter((c) => c.type === channelType);
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
  }

  it("indexes events into all 'all' mode channels", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all-music", feedMode: "all" }),
    ];

    const event = makeTrackEvent({ id: "evt-public", pubkey: "member-a" });
    simulateIndexing(store, event, space, channels);

    expect(store.getState().events.spaceFeeds["space-1:ch-all-music"]).toEqual(["evt-public"]);
  });

  it("skips curated channels for events without channel tag", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all-music", feedMode: "all" }),
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
    ];

    // Event has no ["channel", ...] tag
    const event = makeTrackEvent({ id: "evt-no-tag", pubkey: "member-a" });
    simulateIndexing(store, event, space, channels);

    // Should appear in "all" but NOT in "curated"
    expect(store.getState().events.spaceFeeds["space-1:ch-all-music"]).toEqual(["evt-no-tag"]);
    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).toBeUndefined();
  });

  it("indexes events with matching channel tag into curated channel", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all-music", feedMode: "all" }),
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
    ];

    // Event explicitly targets the curated channel
    const event = makeTrackEvent({
      id: "evt-curated",
      pubkey: "member-a",
      tags: [
        ["d", "curated-track"],
        ["title", "Curated Track"],
        ["artist", "Artist A"],
        ["h", "space-1"],
        ["channel", "ch-originals"],
      ],
    });
    simulateIndexing(store, event, space, channels);

    // Should appear ONLY in the targeted curated channel, not in all-mode
    expect(store.getState().events.spaceFeeds["space-1:ch-all-music"]).toBeUndefined();
    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).toEqual(["evt-curated"]);
  });

  it("rejects events with wrong channel tag from curated channel", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
      makeChannel({ id: "ch-covers", feedMode: "curated" }),
    ];

    // Event targets ch-originals, NOT ch-covers
    const event = makeTrackEvent({
      id: "evt-tagged",
      pubkey: "member-a",
      tags: [
        ["d", "tagged-track"],
        ["title", "Tagged Track"],
        ["artist", "Artist A"],
        ["h", "space-1"],
        ["channel", "ch-originals"],
      ],
    });
    simulateIndexing(store, event, space, channels);

    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).toEqual(["evt-tagged"]);
    expect(store.getState().events.spaceFeeds["space-1:ch-covers"]).toBeUndefined();
  });

  it("handles space with only curated channels (no all-mode)", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
    ];

    // Untagged event should appear nowhere
    const event = makeTrackEvent({ id: "evt-untagged", pubkey: "member-a" });
    simulateIndexing(store, event, space, channels);

    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).toBeUndefined();
  });

  it("handles space with only all-mode channels", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-music", feedMode: "all" }),
    ];

    // All member events should appear
    const event = makeTrackEvent({ id: "evt-member", pubkey: "member-a" });
    simulateIndexing(store, event, space, channels);

    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).toEqual(["evt-member"]);
  });

  it("event with channel tag does NOT spill into all-mode channels", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all-music", feedMode: "all" }),
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
    ];

    const event = makeTrackEvent({
      id: "evt-tagged",
      pubkey: "member-a",
      tags: [
        ["d", "track"],
        ["title", "Track"],
        ["artist", "A"],
        ["channel", "ch-originals"],
      ],
    });
    simulateIndexing(store, event, space, channels);

    // Channel-tagged events only go to their target channel
    expect(store.getState().events.spaceFeeds["space-1:ch-all-music"]).toBeUndefined();
    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).toEqual(["evt-tagged"]);
  });

  it("multiple events distribute correctly across multiple curated channels", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all", feedMode: "all" }),
      makeChannel({ id: "ch-originals", feedMode: "curated" }),
      makeChannel({ id: "ch-covers", feedMode: "curated" }),
    ];

    const evtOriginal = makeTrackEvent({
      id: "evt-orig",
      tags: [["d", "t1"], ["title", "Original"], ["artist", "A"], ["channel", "ch-originals"]],
    });
    const evtCover = makeTrackEvent({
      id: "evt-cover",
      tags: [["d", "t2"], ["title", "Cover"], ["artist", "A"], ["channel", "ch-covers"]],
    });
    const evtPlain = makeTrackEvent({
      id: "evt-plain",
      tags: [["d", "t3"], ["title", "Plain"], ["artist", "A"]],
    });

    simulateIndexing(store, evtOriginal, space, channels);
    simulateIndexing(store, evtCover, space, channels);
    simulateIndexing(store, evtPlain, space, channels);

    // All-mode gets only untagged events (tagged ones go to their specific channel)
    expect(store.getState().events.spaceFeeds["space-1:ch-all"]).toEqual(["evt-plain"]);
    // Originals gets only its tagged event
    expect(store.getState().events.spaceFeeds["space-1:ch-originals"]).toEqual(["evt-orig"]);
    // Covers gets only its tagged event
    expect(store.getState().events.spaceFeeds["space-1:ch-covers"]).toEqual(["evt-cover"]);
  });

  it("album events follow the same curated rules as tracks", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-all", feedMode: "all" }),
      makeChannel({ id: "ch-curated", feedMode: "curated" }),
    ];

    // Simulate for album kind (33123) — the filtering logic is kind-agnostic
    const albumEvent: NostrEvent = {
      id: "evt-album",
      pubkey: "member-a",
      created_at: 1718452800,
      kind: 33123,
      tags: [
        ["d", "album-slug"],
        ["title", "Test Album"],
        ["artist", "Artist A"],
        ["channel", "ch-curated"],
      ],
      content: "",
      sig: "0".repeat(128),
    };
    simulateIndexing(store, albumEvent, space, channels);

    // Channel-tagged: only appears in target channel
    expect(store.getState().events.spaceFeeds["space-1:ch-all"]).toBeUndefined();
    expect(store.getState().events.spaceFeeds["space-1:ch-curated"]).toEqual(["evt-album"]);
  });
});

// ─── Edge cases ─────────────────────────────────────

describe("curated channel edge cases", () => {
  function simulateIndexing(
    store: ReturnType<typeof createTestStore>,
    event: NostrEvent,
    space: Space,
    channels: SpaceChannel[],
  ) {
    // H-tag space scoping: skip if event targets a different space
    const eventHTag = event.tags.find((t) => t[0] === "h")?.[1];
    if (eventHTag && eventHTag !== space.id) return;

    const channelType = "music";
    const matchingChannels = channels.filter((c) => c.type === channelType);
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
  }

  it("empty channels array indexes nothing", () => {
    const store = createTestStore();
    const space = makeSpace();
    const event = makeTrackEvent({ id: "evt-orphan" });
    simulateIndexing(store, event, space, []);

    expect(Object.keys(store.getState().events.spaceFeeds)).toHaveLength(0);
  });

  it("event with channel tag for a non-existent channel is ignored by curated", () => {
    const store = createTestStore();
    const space = makeSpace();
    const channels: SpaceChannel[] = [
      makeChannel({ id: "ch-curated", feedMode: "curated" }),
    ];

    const event = makeTrackEvent({
      id: "evt-bad-tag",
      tags: [
        ["d", "t"],
        ["title", "T"],
        ["artist", "A"],
        ["channel", "ch-nonexistent"], // targets a channel that doesn't exist
      ],
    });
    simulateIndexing(store, event, space, channels);

    // ch-curated requires tag match "ch-curated" but got "ch-nonexistent"
    expect(store.getState().events.spaceFeeds["space-1:ch-curated"]).toBeUndefined();
  });

  it("non-music channels are unaffected by feedMode", () => {
    const store = createTestStore();
    const space = makeSpace();
    // Notes channel with feedMode shouldn't filter (it's only relevant for music)
    const channels: SpaceChannel[] = [
      {
        id: "ch-notes",
        spaceId: "space-1",
        type: "notes",
        label: "#notes",
        position: 0,
        isDefault: true,
        adminOnly: false,
        slowModeSeconds: 0,
        feedMode: "all", // feedMode on non-music channel
      },
    ];

    // The simulateIndexing only looks at "music" type, so notes events
    // wouldn't be processed. This is by design — feedMode only matters for music.
    const noteEvent: NostrEvent = {
      id: "evt-note",
      pubkey: "member-a",
      created_at: 1718452800,
      kind: 1,
      tags: [],
      content: "Hello",
      sig: "0".repeat(128),
    };
    simulateIndexing(store, noteEvent, space, channels);

    // No music channel match, so nothing indexed via this path
    expect(store.getState().events.spaceFeeds["space-1:ch-notes"]).toBeUndefined();
  });

  it("switching feedMode from curated to all causes all future events to index", () => {
    const store = createTestStore();
    const space = makeSpace();

    // Start with curated
    let channels: SpaceChannel[] = [
      makeChannel({ id: "ch-music", feedMode: "curated" }),
    ];

    const evt1 = makeTrackEvent({ id: "evt-1" }); // no channel tag
    simulateIndexing(store, evt1, space, channels);
    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).toBeUndefined();

    // Admin switches to "all" mode
    channels = [makeChannel({ id: "ch-music", feedMode: "all" })];

    const evt2 = makeTrackEvent({ id: "evt-2" }); // no channel tag
    simulateIndexing(store, evt2, space, channels);
    expect(store.getState().events.spaceFeeds["space-1:ch-music"]).toEqual(["evt-2"]);
  });

  it("deduplicates when event is indexed into same channel twice", () => {
    const store = createTestStore();
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-music", eventId: "evt-1" }));
    store.dispatch(indexSpaceFeed({ contextId: "space-1:ch-music", eventId: "evt-1" }));

    // eventsSlice deduplicates
    const feed = store.getState().events.spaceFeeds["space-1:ch-music"];
    expect(feed).toHaveLength(1);
  });
});
