import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface FriendRequest {
  id: string;
  pubkey: string;
  message: string;
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
}

const initialState: FriendRequestState = {
  requests: [],
  processedWrapIds: [],
  removedPubkeys: [],
};

export const friendRequestSlice = createSlice({
  name: "friendRequests",
  initialState,
  reducers: {
    addFriendRequest(state, action: PayloadAction<FriendRequest>) {
      const req = action.payload;

      // Dedup by wrap ID
      if (state.processedWrapIds.includes(req.id)) return;
      state.processedWrapIds.push(req.id);
      if (state.processedWrapIds.length > 3000) {
        state.processedWrapIds = state.processedWrapIds.slice(-2000);
      }

      // Check for ANY existing request from same pubkey+direction (not just pending).
      // This prevents duplicate entries after friend→unfriend→re-friend cycles where
      // old accepted/declined entries would coexist with new pending ones.
      const existingIdx = state.requests.findIndex(
        (r) => r.pubkey === req.pubkey && r.direction === req.direction,
      );
      if (existingIdx >= 0) {
        const existing = state.requests[existingIdx];
        // Replace if: new request is newer, OR existing was already resolved (accepted/declined)
        // and we're getting a fresh pending request (new friendship cycle)
        if (
          req.createdAt > existing.createdAt ||
          (existing.status !== "pending" && req.status === "pending")
        ) {
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
      if (req) req.status = "accepted";
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
      if (req) req.status = "accepted";
    },

    cancelFriendRequest(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      state.requests = state.requests.filter(
        (r) => !(r.pubkey === pubkey && r.direction === "outgoing" && r.status === "pending"),
      );
      // Track so relay re-delivery doesn't resurrect the cancelled request
      if (!state.removedPubkeys.includes(pubkey)) {
        state.removedPubkeys.push(pubkey);
      }
    },

    /** Remove friend — clears ALL requests for this pubkey (both directions, any status)
     *  and tracks pubkey to prevent relay resurrection */
    removeFriend(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      state.requests = state.requests.filter((r) => r.pubkey !== pubkey);
      if (!state.removedPubkeys.includes(pubkey)) {
        state.removedPubkeys.push(pubkey);
      }
    },

    /** Clear a pubkey from the removed list (when user explicitly re-sends a request) */
    clearRemovedPubkey(state, action: PayloadAction<string>) {
      state.removedPubkeys = state.removedPubkeys.filter((pk) => pk !== action.payload);
    },

    /** Track a wrap ID as processed (used by accept wraps that don't go through addFriendRequest) */
    addProcessedWrapId(state, action: PayloadAction<string>) {
      if (state.processedWrapIds.includes(action.payload)) return;
      state.processedWrapIds.push(action.payload);
      if (state.processedWrapIds.length > 3000) {
        state.processedWrapIds = state.processedWrapIds.slice(-2000);
      }
    },

    restoreFriendRequestState(
      state,
      action: PayloadAction<{
        requests?: FriendRequest[];
        processedWrapIds?: string[];
        removedPubkeys?: string[];
      }>,
    ) {
      if (action.payload.requests) state.requests = action.payload.requests;
      if (action.payload.processedWrapIds)
        state.processedWrapIds = action.payload.processedWrapIds;
      if (action.payload.removedPubkeys)
        state.removedPubkeys = action.payload.removedPubkeys;
    },
  },
});

export const {
  addFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  markOutgoingAccepted,
  cancelFriendRequest,
  removeFriend,
  clearRemovedPubkey,
  addProcessedWrapId,
  restoreFriendRequestState,
} = friendRequestSlice.actions;
