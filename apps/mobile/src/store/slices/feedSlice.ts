// Global/discover notes feed (kind 1) — the first live surface (W2), now
// per-context: "global" (firehose) and "follows" (kind-3 authors) hold
// independent id/entity buckets behind one active-context switch. Ordered ids
// + entity map, newest first, hard-capped per context for mobile memory
// discipline (guide 06 §5). The engine feeds it: hydrate from SQLite first,
// then live relay events; filter swaps ride the same relay sub id.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { NostrEvent } from "@thewired/shared-types";

export type FeedContext = "global" | "follows";
export const FEED_CONTEXTS: readonly FeedContext[] = ["global", "follows"];

export type FeedStatus = "idle" | "loading" | "live";

/** Feed size cap per context — plenty for a v1 scroll, small enough for Jetsam. */
export const FEED_CAP = 200;

interface FeedContextState {
  ids: string[];
  entities: Record<string, NostrEvent>;
  status: FeedStatus;
  /** Newest created_at seen — fresh-`since` resubscribes on foreground/switch. */
  lastSeenAt: number;
}

interface FeedState {
  /** The context the feed UI is showing (and the engine is subscribed to). */
  context: FeedContext;
  byContext: Record<FeedContext, FeedContextState>;
}

function emptyContext(): FeedContextState {
  return { ids: [], entities: {}, status: "idle", lastSeenAt: 0 };
}

const initialState: FeedState = {
  context: "global",
  byContext: { global: emptyContext(), follows: emptyContext() },
};

function insertSorted(ctx: FeedContextState, events: NostrEvent[]): void {
  let changed = false;
  for (const event of events) {
    if (ctx.entities[event.id]) continue;
    ctx.entities[event.id] = event;
    changed = true;
    if (event.created_at > ctx.lastSeenAt) ctx.lastSeenAt = event.created_at;
  }
  if (!changed) return;

  ctx.ids = Object.keys(ctx.entities)
    .sort((a, b) => ctx.entities[b].created_at - ctx.entities[a].created_at)
    .slice(0, FEED_CAP);

  // Drop entities that fell off the cap so memory stays bounded.
  const keep = new Set(ctx.ids);
  for (const id of Object.keys(ctx.entities)) {
    if (!keep.has(id)) delete ctx.entities[id];
  }
}

export const feedSlice = createSlice({
  name: "feed",
  initialState,
  reducers: {
    feedContextSwitched(state, action: PayloadAction<FeedContext>) {
      state.context = action.payload;
    },
    feedStatusChanged(
      state,
      action: PayloadAction<{ context: FeedContext; status: FeedStatus }>,
    ) {
      state.byContext[action.payload.context].status = action.payload.status;
    },
    /** SQLite hydration — never regresses a live feed to older state. */
    feedHydrated(
      state,
      action: PayloadAction<{ context: FeedContext; events: NostrEvent[] }>,
    ) {
      const ctx = state.byContext[action.payload.context];
      insertSorted(ctx, action.payload.events);
      if (ctx.status === "idle") ctx.status = "loading";
    },
    feedEventsReceived(
      state,
      action: PayloadAction<{ context: FeedContext; events: NostrEvent[] }>,
    ) {
      insertSorted(state.byContext[action.payload.context], action.payload.events);
    },
    /** One context (identity change clears follows) or, with no payload, all. */
    feedCleared(state, action: PayloadAction<{ context: FeedContext } | undefined>) {
      const context = action.payload?.context;
      if (context) {
        state.byContext[context] = emptyContext();
      } else {
        state.byContext = { global: emptyContext(), follows: emptyContext() };
      }
    },
  },
});

export const {
  feedContextSwitched,
  feedStatusChanged,
  feedHydrated,
  feedEventsReceived,
  feedCleared,
} = feedSlice.actions;

// --- Selectors (typed structurally to avoid a circular store import) ---
type WithFeed = { feed: FeedState };

export const selectFeedContext = (s: WithFeed): FeedContext => s.feed.context;

export const selectActiveFeed = (s: WithFeed): FeedContextState =>
  s.feed.byContext[s.feed.context];

/** Look an event up across contexts (thread roots may live in either). */
export const selectFeedEvent = (s: WithFeed, id: string): NostrEvent | undefined =>
  s.feed.byContext.global.entities[id] ?? s.feed.byContext.follows.entities[id];
