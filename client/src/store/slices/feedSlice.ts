import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface FeedMeta {
  isRefreshing: boolean;
  isLoadingMore: boolean;
  /** False once a page returns fewer events than pageSize */
  hasMore: boolean;
  /** Timestamp of the newest event in this feed (for since param on refresh) */
  newestAt: number;
  /** Timestamp of the oldest event in this feed (for until param on loadMore) */
  oldestAt: number;
}

interface FeedState {
  /** Keyed by contextId: `${spaceId}:${channelType}` */
  meta: Record<string, FeedMeta>;
}

const initialState: FeedState = {
  meta: {},
};

function ensureMeta(state: FeedState, contextId: string): FeedMeta {
  if (!state.meta[contextId]) {
    state.meta[contextId] = {
      isRefreshing: false,
      isLoadingMore: false,
      hasMore: true,
      newestAt: 0,
      oldestAt: 0,
    };
  }
  return state.meta[contextId];
}

export const feedSlice = createSlice({
  name: "feed",
  initialState,
  reducers: {
    /** Record an event timestamp for a feed context (updates newest/oldest) */
    trackFeedTimestamp(
      state,
      action: PayloadAction<{ contextId: string; createdAt: number }>,
    ) {
      const meta = ensureMeta(state, action.payload.contextId);
      const ts = action.payload.createdAt;
      if (ts > meta.newestAt) meta.newestAt = ts;
      if (meta.oldestAt === 0 || ts < meta.oldestAt) meta.oldestAt = ts;
    },

    setRefreshing(
      state,
      action: PayloadAction<{ contextId: string; value: boolean }>,
    ) {
      ensureMeta(state, action.payload.contextId).isRefreshing =
        action.payload.value;
    },

    setLoadingMore(
      state,
      action: PayloadAction<{ contextId: string; value: boolean }>,
    ) {
      ensureMeta(state, action.payload.contextId).isLoadingMore =
        action.payload.value;
    },

    setHasMore(
      state,
      action: PayloadAction<{ contextId: string; value: boolean }>,
    ) {
      ensureMeta(state, action.payload.contextId).hasMore =
        action.payload.value;
    },

    /** Update oldestAt after a load-more page finishes */
    setOldestAt(
      state,
      action: PayloadAction<{ contextId: string; value: number }>,
    ) {
      ensureMeta(state, action.payload.contextId).oldestAt =
        action.payload.value;
    },

    clearFeedMeta(state, action: PayloadAction<string>) {
      delete state.meta[action.payload];
    },
  },
});

export const {
  trackFeedTimestamp,
  setRefreshing,
  setLoadingMore,
  setHasMore,
  setOldestAt,
  clearFeedMeta,
} = feedSlice.actions;
