// ─── Session thread cache ─────────────────────────────────────────────
// Conversations keyed by root event id, so opening/re-opening any note in a
// thread renders instantly from cache instead of re-paying the relay round
// trip (the spaceChat hydrate-before-network shape, minus SQLite — session
// only for now). Owns the event BODIES: reply events live nowhere else
// (engagementSlice keeps only ids, feedSlice prunes at FEED_CAP). One merge
// path (threadEventsMerged) serves the root fetch, the subtree fetch, the
// composer's optimistic insert, live arrivals, and feed-peek seeding.
// Mute filtering happens at render (reducers can't read the moderation
// slice), matching the spaceChat contract.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { compareEventsChrono } from "@thewired/core";
import type { NostrEvent } from "@thewired/shared-types";

/** Max cached conversations — LRU-evicted (whole roots) beyond this. */
export const THREAD_ROOT_CAP = 20;
/** Per-conversation event cap — newest kept, but never the root event. */
export const THREAD_EVENTS_CAP = 300;
/** loadThread reply-page size; >= this many replies ⇒ truncated. */
export const REPLY_PAGE_LIMIT = 100;
/** Cache age beyond which an open thread refetches in the background. */
export const THREAD_STALE_SEC = 60;

export type ThreadStatus = "idle" | "loading" | "ready" | "refreshing";

export interface ThreadEntry {
  /** compareEventsChrono asc, id-deduped, ≤ THREAD_EVENTS_CAP. */
  events: NostrEvent[];
  /** "idle" = seeded only (peek/composer) — a full loadThread is still owed. */
  status: ThreadStatus;
  /** Epoch seconds of the last completed loadThread; 0 until then. */
  fetchedAt: number;
  /** The reply fetch hit REPLY_PAGE_LIMIT — older replies may be missing. */
  truncated: boolean;
  /** Oldest known created_at among replies tagging the root — pagination watermark. */
  oldestReplyAt: number | null;
  loadingOlder: boolean;
}

interface ThreadsState {
  byRoot: Record<string, ThreadEntry>;
  /** LRU bookkeeping — most recently used last. */
  rootOrder: string[];
  /** Any cached event id → its conversation root (evicted with the root). */
  aliasToRoot: Record<string, string>;
  /** Roots whose SQLite row was read this session — dedups hydrate reads. */
  hydrated: Record<string, true>;
}

const initialState: ThreadsState = {
  byRoot: {},
  rootOrder: [],
  aliasToRoot: {},
  hydrated: {},
};

function emptyEntry(): ThreadEntry {
  return {
    events: [],
    status: "idle",
    fetchedAt: 0,
    truncated: false,
    oldestReplyAt: null,
    loadingOlder: false,
  };
}

function touchRoot(state: ThreadsState, rootId: string): void {
  const at = state.rootOrder.indexOf(rootId);
  if (at !== -1) state.rootOrder.splice(at, 1);
  state.rootOrder.push(rootId);
  while (state.rootOrder.length > THREAD_ROOT_CAP) {
    const evicted = state.rootOrder.shift() as string;
    delete state.byRoot[evicted];
    for (const [id, root] of Object.entries(state.aliasToRoot)) {
      if (root === evicted) delete state.aliasToRoot[id];
    }
  }
}

/** Merge + sort + cap. The root event is exempt from the newest-wins cap —
 *  it's the oldest event in the conversation and must stay renderable. */
function mergeEvents(entry: ThreadEntry, rootId: string, incoming: NostrEvent[]): void {
  const present = new Set(entry.events.map((e) => e.id));
  let changed = false;
  for (const event of incoming) {
    if (event.kind !== 1 || present.has(event.id)) continue;
    present.add(event.id);
    entry.events.push(event);
    changed = true;
  }
  if (!changed) return;
  entry.events.sort(compareEventsChrono);
  if (entry.events.length > THREAD_EVENTS_CAP) {
    const root = entry.events.find((e) => e.id === rootId);
    const kept = entry.events
      .filter((e) => e.id !== rootId)
      .slice(-(root ? THREAD_EVENTS_CAP - 1 : THREAD_EVENTS_CAP));
    entry.events = root ? [root, ...kept] : kept;
  }
}

export const threadsSlice = createSlice({
  name: "threads",
  initialState,
  reducers: {
    /** loadThread began — "loading" cold, "refreshing" when cache is warm (SWR). */
    threadFetchStarted(state, action: PayloadAction<{ rootId: string }>) {
      const { rootId } = action.payload;
      const entry = (state.byRoot[rootId] ??= emptyEntry());
      entry.status = entry.events.length > 0 ? "refreshing" : "loading";
      touchRoot(state, rootId);
    },

    /** The single merge path — root/subtree fetches, optimistic composer
     *  inserts, live arrivals, and peek seeding all land here. */
    threadEventsMerged(
      state,
      action: PayloadAction<{ rootId: string; events: NostrEvent[] }>,
    ) {
      const { rootId, events } = action.payload;
      const entry = (state.byRoot[rootId] ??= emptyEntry());
      mergeEvents(entry, rootId, events);
      for (const event of entry.events) state.aliasToRoot[event.id] = rootId;
      touchRoot(state, rootId);
    },

    /** Stored conversation — MERGE with whatever already landed (a live
     *  fetch can beat the SQLite read); an empty row still marks the root
     *  hydrated so the read isn't repeated. */
    threadHydrated(
      state,
      action: PayloadAction<{ rootId: string; events: NostrEvent[] }>,
    ) {
      const { rootId, events } = action.payload;
      if (events.length > 0) {
        const entry = (state.byRoot[rootId] ??= emptyEntry());
        mergeEvents(entry, rootId, events);
        for (const event of entry.events) state.aliasToRoot[event.id] = rootId;
        touchRoot(state, rootId);
      }
      state.hydrated[rootId] = true;
    },

    threadFetchCompleted(
      state,
      action: PayloadAction<{
        rootId: string;
        fetchedAt: number;
        truncated: boolean;
        oldestReplyAt: number | null;
      }>,
    ) {
      const entry = state.byRoot[action.payload.rootId];
      if (!entry) return; // evicted mid-flight
      entry.status = "ready";
      entry.fetchedAt = action.payload.fetchedAt;
      entry.truncated = action.payload.truncated;
      entry.oldestReplyAt = action.payload.oldestReplyAt;
    },

    threadOlderStarted(state, action: PayloadAction<{ rootId: string }>) {
      const entry = state.byRoot[action.payload.rootId];
      if (entry) entry.loadingOlder = true;
    },

    threadOlderCompleted(
      state,
      action: PayloadAction<{
        rootId: string;
        oldestReplyAt: number | null;
        exhausted: boolean;
      }>,
    ) {
      const entry = state.byRoot[action.payload.rootId];
      if (!entry) return;
      entry.loadingOlder = false;
      entry.oldestReplyAt = action.payload.oldestReplyAt;
      if (action.payload.exhausted) entry.truncated = false;
    },

    /** Logout / account switch. */
    threadsCleared() {
      return initialState;
    },
  },
});

export const {
  threadFetchStarted,
  threadEventsMerged,
  threadHydrated,
  threadFetchCompleted,
  threadOlderStarted,
  threadOlderCompleted,
  threadsCleared,
} = threadsSlice.actions;

// ─── Selectors (structurally typed to avoid the store/index.ts cycle) ──

interface WithThreads {
  threads: ThreadsState;
}

const EMPTY_EVENTS: NostrEvent[] = [];

export function selectThreadEntry(
  state: WithThreads,
  rootId: string | undefined,
): ThreadEntry | undefined {
  return rootId ? state.threads.byRoot[rootId] : undefined;
}

export function selectThreadEvents(
  state: WithThreads,
  rootId: string | undefined,
): NostrEvent[] {
  return (rootId && state.threads.byRoot[rootId]?.events) || EMPTY_EVENTS;
}

/** Resolve any cached event id to its conversation root. */
export function selectRootIdFor(state: WithThreads, noteId: string): string | undefined {
  return state.threads.aliasToRoot[noteId] ?? (state.threads.byRoot[noteId] ? noteId : undefined);
}
