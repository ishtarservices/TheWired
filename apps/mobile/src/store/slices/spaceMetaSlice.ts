// ─── Space-meta cache ─────────────────────────────────────────────────
// Space detail/channels/display-roster + the my-spaces list, cached with
// the threads-family SWR shape: hydrate from SQLite for instant paint, a
// status machine whose "refreshing" keeps stale data on screen, LRU beyond
// SPACE_META_CAP with joined (mySpaces) ids pinned. Replaces the 45s
// in-memory spaceCache promise maps — entries are serializable and
// selectable, so screens share one fetch and stale-resolve races die by
// construction. Membership checks are deliberately NOT served from here:
// lib/api/membership.ts stays the authority (join-CTA correctness).

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

import type { MySpace, SpaceChannel, SpaceDetail } from "@/lib/api/spaces";

/** Cache age beyond which an on-screen space refetches in the background. */
export const SPACE_META_STALE_SEC = 60;
/** Max cached spaces — LRU-evicted beyond this; ids in mySpaces are pinned. */
export const SPACE_META_CAP = 30;
/** Persisted display-roster prefix — facepiles need a handful, not the roster. */
export const PERSIST_ROSTER_CAP = 50;

export type SpaceMetaStatus = "idle" | "loading" | "ready" | "refreshing";

export interface SpaceMetaEntry {
  detail: SpaceDetail | null;
  channels: SpaceChannel[] | null;
  /**
   * DISPLAY-ONLY roster prefix — facepiles, avatar stacks, header counts.
   * NEVER use for membership checks or feed-author resolution: after a
   * hydrate this can be a stale PERSIST_ROSTER_CAP-row prefix of the real
   * roster. Membership checks and full rosters MUST go through
   * lib/api/membership.ts (uncached-by-contract).
   */
  memberPubkeys: string[];
  /** "idle" = hydrated/seeded only — a loadSpaceMeta is still owed. */
  status: SpaceMetaStatus;
  /** Epoch seconds of the last completed fetch; 0 = never / invalidated. */
  fetchedAt: number;
  error: string | null;
}

/** The persisted subset spaceMetaHydrated restores (store/spaceMeta.ts row). */
export interface SpaceMetaHydrateEntry {
  detail: SpaceDetail | null;
  channels: SpaceChannel[] | null;
  memberPubkeys: string[];
  fetchedAt: number;
}

interface SpaceMetaState {
  bySpace: Record<string, SpaceMetaEntry>;
  /** LRU bookkeeping — most recently used last. */
  spaceOrder: string[];
  /** Spaces whose SQLite row was read this session — dedups hydrate reads. */
  hydrated: Record<string, true>;
  /** null until the first load/hydrate answers (guests resolve to []). */
  mySpaces: MySpace[] | null;
  mySpacesStatus: SpaceMetaStatus;
  mySpacesFetchedAt: number;
  mySpacesHydrated: boolean;
}

const initialState: SpaceMetaState = {
  bySpace: {},
  spaceOrder: [],
  hydrated: {},
  mySpaces: null,
  mySpacesStatus: "idle",
  mySpacesFetchedAt: 0,
  mySpacesHydrated: false,
};

function emptyEntry(): SpaceMetaEntry {
  return {
    detail: null,
    channels: null,
    memberPubkeys: [],
    status: "idle",
    fetchedAt: 0,
    error: null,
  };
}

/** LRU touch + evict past the cap — joined (mySpaces) ids and the touched
 *  id itself are never evicted, so the cap yields when everything left is
 *  pinned rather than dropping a space the user is inside. */
function touchSpace(state: SpaceMetaState, spaceId: string): void {
  const at = state.spaceOrder.indexOf(spaceId);
  if (at !== -1) state.spaceOrder.splice(at, 1);
  state.spaceOrder.push(spaceId);
  if (state.spaceOrder.length <= SPACE_META_CAP) return;
  const joined = new Set((state.mySpaces ?? []).map((s) => s.id));
  while (state.spaceOrder.length > SPACE_META_CAP) {
    const evictAt = state.spaceOrder.findIndex(
      (id) => id !== spaceId && !joined.has(id),
    );
    if (evictAt === -1) break; // everything left is pinned — cap yields
    const [evicted] = state.spaceOrder.splice(evictAt, 1);
    delete state.bySpace[evicted];
  }
}

export const spaceMetaSlice = createSlice({
  name: "spaceMeta",
  initialState,
  reducers: {
    /** loadSpaceMeta began — "loading" cold, "refreshing" when the entry
     *  already has a detail to keep on screen (SWR). */
    spaceMetaFetchStarted(state, action: PayloadAction<{ spaceId: string }>) {
      const { spaceId } = action.payload;
      const entry = (state.bySpace[spaceId] ??= emptyEntry());
      entry.status = entry.detail !== null ? "refreshing" : "loading";
      touchSpace(state, spaceId);
    },

    /** Missing-entry guard doubles as the identity valve: spaceMetaCleared
     *  (or an LRU eviction) mid-flight drops the entry, a late success
     *  no-ops here, and the persist step in loadSpaceMeta sees nothing to
     *  write (threadFetchCompleted's "evicted mid-flight" contract). */
    spaceMetaFetchSucceeded(
      state,
      action: PayloadAction<{
        spaceId: string;
        detail: SpaceDetail;
        channels: SpaceChannel[];
        memberPubkeys: string[];
        fetchedAt: number;
      }>,
    ) {
      const entry = state.bySpace[action.payload.spaceId];
      if (!entry) return; // evicted/cleared mid-flight
      entry.detail = action.payload.detail;
      entry.channels = action.payload.channels;
      entry.memberPubkeys = action.payload.memberPubkeys;
      entry.status = "ready";
      entry.fetchedAt = action.payload.fetchedAt;
      entry.error = null;
    },

    /** Keep whatever data the entry holds — a failed background refresh
     *  must not blank a painted screen. */
    spaceMetaFetchFailed(
      state,
      action: PayloadAction<{ spaceId: string; error: string }>,
    ) {
      const entry = state.bySpace[action.payload.spaceId];
      if (!entry) return; // evicted/cleared mid-flight
      entry.status = entry.detail !== null ? "ready" : "idle";
      entry.error = action.payload.error;
    },

    /** Stored row — merge only while the slice entry is emptier (a live
     *  fetch can beat the SQLite read; disk never overwrites it). A null
     *  row still marks the space hydrated so the read isn't repeated. */
    spaceMetaHydrated(
      state,
      action: PayloadAction<{ spaceId: string; entry: SpaceMetaHydrateEntry | null }>,
    ) {
      const { spaceId, entry: stored } = action.payload;
      if (stored) {
        const entry = (state.bySpace[spaceId] ??= emptyEntry());
        if (entry.detail === null && entry.channels === null) {
          entry.detail = stored.detail;
          entry.channels = stored.channels;
          entry.memberPubkeys = stored.memberPubkeys;
          entry.fetchedAt = Math.max(entry.fetchedAt, stored.fetchedAt);
        }
        touchSpace(state, spaceId);
      }
      state.hydrated[spaceId] = true;
    },

    /** Join/leave: the data stays warm on screen, but the next load
     *  refetches regardless of age. */
    spaceMetaInvalidated(state, action: PayloadAction<{ spaceId: string }>) {
      const entry = state.bySpace[action.payload.spaceId];
      if (entry) entry.fetchedAt = 0;
    },

    mySpacesFetchStarted(state) {
      state.mySpacesStatus = state.mySpaces !== null ? "refreshing" : "loading";
    },

    /** Status guard = the my-spaces identity valve: spaceMetaCleared resets
     *  the status to "idle", so a stale identity's in-flight list resolving
     *  late is ignored (and loadMySpaces then skips persistence). */
    mySpacesFetchSucceeded(
      state,
      action: PayloadAction<{ spaces: MySpace[]; fetchedAt: number }>,
    ) {
      if (state.mySpacesStatus !== "loading" && state.mySpacesStatus !== "refreshing") {
        return;
      }
      state.mySpaces = action.payload.spaces;
      state.mySpacesStatus = "ready";
      state.mySpacesFetchedAt = action.payload.fetchedAt;
    },

    mySpacesFetchFailed(state) {
      if (state.mySpacesStatus !== "loading" && state.mySpacesStatus !== "refreshing") {
        return;
      }
      state.mySpacesStatus = state.mySpaces !== null ? "ready" : "idle";
    },

    /** Stored list — merge only while the slice is emptier (fetchedAt stays
     *  0 so the next loadMySpaces still refreshes). null still sets the
     *  hydrated flag so the read isn't repeated. */
    mySpacesHydrated(state, action: PayloadAction<{ spaces: MySpace[] | null }>) {
      if (state.mySpaces === null && action.payload.spaces !== null) {
        state.mySpaces = action.payload.spaces;
      }
      state.mySpacesHydrated = true;
    },

    /** Join/leave: keep the list on screen, force the next load to refetch. */
    mySpacesInvalidated(state) {
      state.mySpacesFetchedAt = 0;
    },

    /** Logout / account switch. */
    spaceMetaCleared() {
      return initialState;
    },
  },
});

export const {
  spaceMetaFetchStarted,
  spaceMetaFetchSucceeded,
  spaceMetaFetchFailed,
  spaceMetaHydrated,
  spaceMetaInvalidated,
  mySpacesFetchStarted,
  mySpacesFetchSucceeded,
  mySpacesFetchFailed,
  mySpacesHydrated,
  mySpacesInvalidated,
  spaceMetaCleared,
} = spaceMetaSlice.actions;

// ─── Selectors (structurally typed to avoid the store/index.ts cycle) ──

interface WithSpaceMeta {
  spaceMeta: SpaceMetaState;
}

export function selectSpaceMeta(
  state: WithSpaceMeta,
  spaceId: string,
): SpaceMetaEntry | undefined {
  return state.spaceMeta.bySpace[spaceId];
}

export function selectMySpaces(state: WithSpaceMeta): MySpace[] | null {
  return state.spaceMeta.mySpaces;
}

export function selectMySpacesStatus(state: WithSpaceMeta): SpaceMetaStatus {
  return state.spaceMeta.mySpacesStatus;
}

export function selectMySpacesFetchedAt(state: WithSpaceMeta): number {
  return state.spaceMeta.mySpacesFetchedAt;
}
