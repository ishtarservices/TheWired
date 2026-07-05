// Global/discover notes feed (kind 1) — the first live surface (W2).
// Ordered ids + entity map, newest first, hard-capped for mobile memory
// discipline (guide 06 §5). The engine feeds it: hydrate from SQLite first,
// then live relay events.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { NostrEvent } from "@thewired/shared-types";

export type FeedStatus = "idle" | "loading" | "live";

/** Feed size cap — plenty for a v1 scroll, small enough for Jetsam. */
export const FEED_CAP = 200;

interface FeedState {
  ids: string[];
  entities: Record<string, NostrEvent>;
  status: FeedStatus;
  /** Newest created_at seen — fresh-`since` resubscribes on foreground. */
  lastSeenAt: number;
}

const initialState: FeedState = {
  ids: [],
  entities: {},
  status: "idle",
  lastSeenAt: 0,
};

function insertSorted(state: FeedState, events: NostrEvent[]): void {
  let changed = false;
  for (const event of events) {
    if (state.entities[event.id]) continue;
    state.entities[event.id] = event;
    changed = true;
    if (event.created_at > state.lastSeenAt) state.lastSeenAt = event.created_at;
  }
  if (!changed) return;

  state.ids = Object.keys(state.entities)
    .sort((a, b) => state.entities[b].created_at - state.entities[a].created_at)
    .slice(0, FEED_CAP);

  // Drop entities that fell off the cap so memory stays bounded.
  const keep = new Set(state.ids);
  for (const id of Object.keys(state.entities)) {
    if (!keep.has(id)) delete state.entities[id];
  }
}

export const feedSlice = createSlice({
  name: "feed",
  initialState,
  reducers: {
    feedStatusChanged(state, action: PayloadAction<FeedStatus>) {
      state.status = action.payload;
    },
    /** SQLite hydration — never regresses a live feed to older state. */
    feedHydrated(state, action: PayloadAction<NostrEvent[]>) {
      insertSorted(state, action.payload);
      if (state.status === "idle") state.status = "loading";
    },
    feedEventsReceived(state, action: PayloadAction<NostrEvent[]>) {
      insertSorted(state, action.payload);
    },
    feedCleared(state) {
      state.ids = [];
      state.entities = {};
      state.status = "idle";
      state.lastSeenAt = 0;
    },
  },
});

export const { feedStatusChanged, feedHydrated, feedEventsReceived, feedCleared } =
  feedSlice.actions;
