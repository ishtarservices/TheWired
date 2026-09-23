import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface FriendRequest {
  id: string;
  pubkey: string;
  message: string;
  /** Rumor `created_at` of the wrap that produced this row (seconds). Used to
   *  order relay replays against removals — NOT the local receive time. */
  createdAt: number;
  status: "pending" | "accepted" | "declined";
  direction: "incoming" | "outgoing";
}

interface FriendRequestState {
  requests: FriendRequest[];
  processedWrapIds: string[];
  /** Pubkeys whose friendship was explicitly removed or cancelled.
   *  Prevents relay re-delivery from resurrecting removed friendships. */
  removedPubkeys: string[];
  /** When (rumor seconds) each pubkey in `removedPubkeys` was removed. A wrap
   *  older than this is a stale replay; a newer one is a genuine new cycle.
   *  Pubkeys persisted before this field existed have no entry and keep the
   *  legacy "always stale" behaviour. */
  removedAt: Record<string, number>;
}

const initialState: FriendRequestState = {
  requests: [],
  processedWrapIds: [],
  removedPubkeys: [],
  removedAt: {},
};

const MAX_WRAP_IDS = 3000;
const TRIM_WRAP_IDS_TO = 2000;

function trackWrapId(state: FriendRequestState, id: string): boolean {
  if (state.processedWrapIds.includes(id)) return false;
  state.processedWrapIds.push(id);
  if (state.processedWrapIds.length > MAX_WRAP_IDS) {
    state.processedWrapIds = state.processedWrapIds.slice(-TRIM_WRAP_IDS_TO);
  }
  return true;
}

/** Once any row for a pubkey is accepted the pair is friends: resolve the
 *  sibling pending row too so the requests UI can't show a stale card. */
function acceptSiblingPending(state: FriendRequestState, pubkey: string): void {
  for (const r of state.requests) {
    if (r.pubkey === pubkey && r.status === "pending") r.status = "accepted";
  }
}

function markRemoved(state: FriendRequestState, pubkey: string, at: number): void {
  if (!state.removedPubkeys.includes(pubkey)) state.removedPubkeys.push(pubkey);
  const prev = state.removedAt[pubkey];
  if (prev === undefined || at > prev) state.removedAt[pubkey] = at;
}

/**
 * Is a wrap with this rumor timestamp a stale replay from before the pubkey
 * was removed? False when the pubkey was never removed, or when the wrap is
 * newer than the removal (a genuine re-friend cycle).
 */
export function isStaleAfterRemoval(
  state: Pick<FriendRequestState, "removedPubkeys" | "removedAt">,
  pubkey: string,
  createdAt: number,
): boolean {
  if (!state.removedPubkeys.includes(pubkey)) return false;
  const at = state.removedAt[pubkey];
  if (at === undefined) return true; // legacy entry without a timestamp
  return createdAt <= at;
}

export const friendRequestSlice = createSlice({
  name: "friendRequests",
  initialState,
  reducers: {
    addFriendRequest(state, action: PayloadAction<FriendRequest>) {
      const req = action.payload;

      // Dedup by wrap ID
      if (!trackWrapId(state, req.id)) return;

      // One row per pubkey+direction. A newer wrap replaces an older row
      // (covers re-sent requests and decline → re-request cycles). An OLDER
      // wrap never replaces a resolved row — that's a relay replay of the
      // original request arriving after the accept that already resolved it.
      const existingIdx = state.requests.findIndex(
        (r) => r.pubkey === req.pubkey && r.direction === req.direction,
      );
      if (existingIdx >= 0) {
        const existing = state.requests[existingIdx];
        if (req.createdAt > existing.createdAt) {
          state.requests[existingIdx] = req;
        }
        return;
      }

      state.requests.push(req);
    },

    acceptFriendRequest(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      const req = state.requests.find(
        (r) => r.pubkey === pubkey && r.direction === "incoming" && r.status === "pending",
      );
      if (!req) return;
      req.status = "accepted";
      acceptSiblingPending(state, pubkey);
    },

    declineFriendRequest(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      const req = state.requests.find(
        (r) => r.pubkey === pubkey && r.direction === "incoming" && r.status === "pending",
      );
      if (req) req.status = "declined";
    },

    markOutgoingAccepted(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      const req = state.requests.find(
        (r) => r.pubkey === pubkey && r.direction === "outgoing" && r.status === "pending",
      );
      if (!req) return;
      req.status = "accepted";
      acceptSiblingPending(state, pubkey);
    },

    /**
     * Apply a `friend_request_accept` wrap. `direction` names the row it
     * resolves: "incoming" for our own self-wrap echo (we accepted their
     * request on another device), "outgoing" for the peer accepting ours.
     * If that row doesn't exist yet (fresh device, newest-first replay) it is
     * created already accepted so the later-arriving request can't reopen it.
     */
    applyAcceptWrap(
      state,
      action: PayloadAction<{
        pubkey: string;
        direction: FriendRequest["direction"];
        wrapId: string;
        createdAt: number;
      }>,
    ) {
      const { pubkey, direction, wrapId, createdAt } = action.payload;
      const row = state.requests.find((r) => r.pubkey === pubkey && r.direction === direction);
      if (row) {
        row.status = "accepted";
      } else {
        state.requests.push({
          id: wrapId,
          pubkey,
          message: "",
          createdAt,
          status: "accepted",
          direction,
        });
      }
      acceptSiblingPending(state, pubkey);
    },

    /**
     * Apply a `friend_request_remove` wrap (ours from another device, or the
     * peer's). Rows newer than the removal belong to a later re-friend cycle
     * and survive; everything older is cleared. The removal time is recorded
     * so older replays of requests/accepts are recognised as stale.
     */
    applyRemoveWrap(state, action: PayloadAction<{ pubkey: string; createdAt: number }>) {
      const { pubkey, createdAt } = action.payload;
      state.requests = state.requests.filter(
        (r) => r.pubkey !== pubkey || r.createdAt > createdAt,
      );
      markRemoved(state, pubkey, createdAt);
    },

    cancelFriendRequest(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      state.requests = state.requests.filter(
        (r) => !(r.pubkey === pubkey && r.direction === "outgoing" && r.status === "pending"),
      );
      // Track so relay re-delivery doesn't resurrect the cancelled request
      markRemoved(state, pubkey, Math.round(Date.now() / 1000));
    },

    /** Remove friend — clears ALL requests for this pubkey (both directions, any status)
     *  and tracks pubkey to prevent relay resurrection */
    removeFriend(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      state.requests = state.requests.filter((r) => r.pubkey !== pubkey);
      markRemoved(state, pubkey, Math.round(Date.now() / 1000));
    },

    /** Clear a pubkey from the removed list (when user explicitly re-sends a request) */
    clearRemovedPubkey(state, action: PayloadAction<string>) {
      state.removedPubkeys = state.removedPubkeys.filter((pk) => pk !== action.payload);
      delete state.removedAt[action.payload];
    },

    /** Track a wrap ID as processed (used by accept wraps that don't go through addFriendRequest) */
    addProcessedWrapId(state, action: PayloadAction<string>) {
      trackWrapId(state, action.payload);
    },

    restoreFriendRequestState(
      state,
      action: PayloadAction<{
        requests?: FriendRequest[];
        processedWrapIds?: string[];
        removedPubkeys?: string[];
        removedAt?: Record<string, number>;
      }>,
    ) {
      if (action.payload.requests) state.requests = action.payload.requests;
      if (action.payload.processedWrapIds)
        state.processedWrapIds = action.payload.processedWrapIds;
      if (action.payload.removedPubkeys)
        state.removedPubkeys = action.payload.removedPubkeys;
      if (action.payload.removedAt) state.removedAt = action.payload.removedAt;
    },
  },
});

export const {
  addFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  markOutgoingAccepted,
  applyAcceptWrap,
  applyRemoveWrap,
  cancelFriendRequest,
  removeFriend,
  clearRemovedPubkey,
  addProcessedWrapId,
  restoreFriendRequestState,
} = friendRequestSlice.actions;
