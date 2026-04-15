import { describe, it, expect } from "vitest";
import { friendRequestSlice, type FriendRequest } from "../friendRequestSlice";
import { identitySlice } from "../identitySlice";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { lunaVega, marcusCole, sageNakamura } from "@/__tests__/fixtures/testUsers";

const {
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

const { setFollowList, login } = identitySlice.actions;

/** Helper to build a friend request payload */
function makeRequest(
  overrides: Partial<FriendRequest> & { pubkey: string },
): FriendRequest {
  return {
    id: `wrap-${overrides.pubkey}-${overrides.direction ?? "incoming"}-${Date.now()}`,
    message: "",
    createdAt: Math.floor(Date.now() / 1000),
    status: "pending",
    direction: "incoming",
    ...overrides,
  };
}

describe("friendRequestSlice", () => {
  // ─── addFriendRequest ──────────────────────────

  it("adds an incoming friend request", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ pubkey: marcusCole.pubkey, direction: "incoming" })));
    const reqs = store.getState().friendRequests.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].pubkey).toBe(marcusCole.pubkey);
    expect(reqs[0].direction).toBe("incoming");
    expect(reqs[0].status).toBe("pending");
  });

  it("adds an outgoing friend request", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ pubkey: marcusCole.pubkey, direction: "outgoing" })));
    const reqs = store.getState().friendRequests.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].direction).toBe("outgoing");
  });

  it("deduplicates by wrap ID", () => {
    const store = createTestStore();
    const req = makeRequest({ id: "dup-wrap", pubkey: marcusCole.pubkey });
    store.dispatch(addFriendRequest(req));
    store.dispatch(addFriendRequest(req));
    expect(store.getState().friendRequests.requests).toHaveLength(1);
  });

  it("replaces an older request from the same pubkey+direction with a newer one", () => {
    const store = createTestStore();
    const old = makeRequest({ id: "wrap-old", pubkey: marcusCole.pubkey, direction: "incoming", createdAt: 100 });
    const newer = makeRequest({ id: "wrap-new", pubkey: marcusCole.pubkey, direction: "incoming", createdAt: 200 });
    store.dispatch(addFriendRequest(old));
    store.dispatch(addFriendRequest(newer));
    const reqs = store.getState().friendRequests.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("wrap-new");
    expect(reqs[0].createdAt).toBe(200);
  });

  it("does not replace a newer request with an older one", () => {
    const store = createTestStore();
    const newer = makeRequest({ id: "wrap-new", pubkey: marcusCole.pubkey, direction: "incoming", createdAt: 200 });
    const old = makeRequest({ id: "wrap-old", pubkey: marcusCole.pubkey, direction: "incoming", createdAt: 100 });
    store.dispatch(addFriendRequest(newer));
    store.dispatch(addFriendRequest(old));
    const reqs = store.getState().friendRequests.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].id).toBe("wrap-new");
  });

  it("allows incoming and outgoing requests for the same pubkey to coexist", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "wrap-in", pubkey: marcusCole.pubkey, direction: "incoming" })));
    store.dispatch(addFriendRequest(makeRequest({ id: "wrap-out", pubkey: marcusCole.pubkey, direction: "outgoing" })));
    expect(store.getState().friendRequests.requests).toHaveLength(2);
  });

  it("replaces a resolved request with a fresh pending one (re-friend cycle)", () => {
    const store = createTestStore();
    // First cycle: request accepted
    const accepted = makeRequest({
      id: "wrap-1", pubkey: marcusCole.pubkey, direction: "incoming",
      status: "accepted", createdAt: 100,
    });
    store.dispatch(addFriendRequest(accepted));

    // New cycle: fresh pending request (even with older timestamp, pending replaces resolved)
    const fresh = makeRequest({
      id: "wrap-2", pubkey: marcusCole.pubkey, direction: "incoming",
      status: "pending", createdAt: 50,
    });
    store.dispatch(addFriendRequest(fresh));
    const reqs = store.getState().friendRequests.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].status).toBe("pending");
  });

  // ─── acceptFriendRequest ───────────────────────

  it("accepts an incoming pending request", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "incoming" })));
    store.dispatch(acceptFriendRequest(marcusCole.pubkey));
    expect(store.getState().friendRequests.requests[0].status).toBe("accepted");
  });

  it("does not accept an already-accepted request (no-op)", () => {
    const store = createTestStore();
    const req = makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "incoming" });
    store.dispatch(addFriendRequest(req));
    store.dispatch(acceptFriendRequest(marcusCole.pubkey));
    store.dispatch(acceptFriendRequest(marcusCole.pubkey)); // second call
    // Still just one request, still accepted
    const reqs = store.getState().friendRequests.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].status).toBe("accepted");
  });

  it("does not accept outgoing requests (only incoming)", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing" })));
    store.dispatch(acceptFriendRequest(marcusCole.pubkey));
    // Outgoing request should still be pending
    expect(store.getState().friendRequests.requests[0].status).toBe("pending");
  });

  // ─── declineFriendRequest ──────────────────────

  it("declines an incoming pending request", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "incoming" })));
    store.dispatch(declineFriendRequest(marcusCole.pubkey));
    expect(store.getState().friendRequests.requests[0].status).toBe("declined");
  });

  it("does not decline outgoing requests", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing" })));
    store.dispatch(declineFriendRequest(marcusCole.pubkey));
    expect(store.getState().friendRequests.requests[0].status).toBe("pending");
  });

  // ─── markOutgoingAccepted ──────────────────────

  it("marks an outgoing pending request as accepted", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing" })));
    store.dispatch(markOutgoingAccepted(marcusCole.pubkey));
    expect(store.getState().friendRequests.requests[0].status).toBe("accepted");
  });

  it("does not affect incoming requests", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "incoming" })));
    store.dispatch(markOutgoingAccepted(marcusCole.pubkey));
    expect(store.getState().friendRequests.requests[0].status).toBe("pending");
  });

  // ─── cancelFriendRequest ───────────────────────

  it("cancels an outgoing pending request and tracks removal", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing" })));
    store.dispatch(cancelFriendRequest(marcusCole.pubkey));
    expect(store.getState().friendRequests.requests).toHaveLength(0);
    expect(store.getState().friendRequests.removedPubkeys).toContain(marcusCole.pubkey);
  });

  it("does not cancel incoming requests", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "incoming" })));
    store.dispatch(cancelFriendRequest(marcusCole.pubkey));
    // Incoming request survives
    expect(store.getState().friendRequests.requests).toHaveLength(1);
  });

  // ─── removeFriend ──────────────────────────────

  it("removes all requests for a pubkey (both directions) and tracks removal", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w-in", pubkey: marcusCole.pubkey, direction: "incoming" })));
    store.dispatch(addFriendRequest(makeRequest({ id: "w-out", pubkey: marcusCole.pubkey, direction: "outgoing" })));
    store.dispatch(removeFriend(marcusCole.pubkey));
    expect(store.getState().friendRequests.requests).toHaveLength(0);
    expect(store.getState().friendRequests.removedPubkeys).toContain(marcusCole.pubkey);
  });

  it("does not affect requests from other pubkeys", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "incoming" })));
    store.dispatch(addFriendRequest(makeRequest({ id: "w2", pubkey: sageNakamura.pubkey, direction: "incoming" })));
    store.dispatch(removeFriend(marcusCole.pubkey));
    const reqs = store.getState().friendRequests.requests;
    expect(reqs).toHaveLength(1);
    expect(reqs[0].pubkey).toBe(sageNakamura.pubkey);
  });

  // ─── clearRemovedPubkey ────────────────────────

  it("clears a pubkey from the removed list (allows re-friending)", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing" })));
    store.dispatch(cancelFriendRequest(marcusCole.pubkey));
    expect(store.getState().friendRequests.removedPubkeys).toContain(marcusCole.pubkey);
    store.dispatch(clearRemovedPubkey(marcusCole.pubkey));
    expect(store.getState().friendRequests.removedPubkeys).not.toContain(marcusCole.pubkey);
  });

  // ─── processedWrapIds ──────────────────────────

  it("tracks processed wrap IDs independently", () => {
    const store = createTestStore();
    store.dispatch(addProcessedWrapId("wrap-abc"));
    store.dispatch(addProcessedWrapId("wrap-abc")); // dedup
    expect(store.getState().friendRequests.processedWrapIds).toEqual(["wrap-abc"]);
  });

  it("trims processedWrapIds when exceeding 3000", () => {
    const store = createTestStore();
    const ids = Array.from({ length: 3001 }, (_, i) => `wrap-${i}`);
    store.dispatch(restoreFriendRequestState({ processedWrapIds: ids }));
    // Adding one more should trigger trim
    store.dispatch(addProcessedWrapId("wrap-overflow"));
    const { processedWrapIds } = store.getState().friendRequests;
    expect(processedWrapIds.length).toBeLessThanOrEqual(3001);
    // Most recent IDs should survive
    expect(processedWrapIds).toContain("wrap-overflow");
  });

  // ─── restoreFriendRequestState ─────────────────

  it("restores partial state without overwriting unset fields", () => {
    const store = createTestStore();
    store.dispatch(addFriendRequest(makeRequest({ id: "w1", pubkey: marcusCole.pubkey })));
    store.dispatch(restoreFriendRequestState({ removedPubkeys: [sageNakamura.pubkey] }));
    // Requests should still be intact
    expect(store.getState().friendRequests.requests).toHaveLength(1);
    expect(store.getState().friendRequests.removedPubkeys).toEqual([sageNakamura.pubkey]);
  });

  // ═══════════════════════════════════════════════
  // Full lifecycle flows
  // ═══════════════════════════════════════════════

  describe("friend request → accept flow", () => {
    it("incoming request accepted: both directions reach accepted status", () => {
      const store = createTestStore();

      // Marcus sends Luna a friend request (incoming from Luna's perspective)
      store.dispatch(addFriendRequest(makeRequest({
        id: "w-in", pubkey: marcusCole.pubkey, direction: "incoming",
      })));

      // Luna accepts
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));

      const reqs = store.getState().friendRequests.requests;
      const incoming = reqs.find((r) => r.direction === "incoming");
      expect(incoming?.status).toBe("accepted");
    });

    it("outgoing request accepted by recipient: markOutgoingAccepted updates status", () => {
      const store = createTestStore();

      // Luna sends Marcus a friend request (outgoing)
      store.dispatch(addFriendRequest(makeRequest({
        id: "w-out", pubkey: marcusCole.pubkey, direction: "outgoing",
      })));

      // Marcus accepts (we receive the accept wrap → markOutgoingAccepted)
      store.dispatch(markOutgoingAccepted(marcusCole.pubkey));

      expect(store.getState().friendRequests.requests[0].status).toBe("accepted");
    });
  });

  describe("friend request → decline flow", () => {
    it("declined request stays in state with declined status", () => {
      const store = createTestStore();
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(declineFriendRequest(marcusCole.pubkey));

      const req = store.getState().friendRequests.requests[0];
      expect(req.status).toBe("declined");
    });
  });

  describe("unfriend flow", () => {
    it("removeFriend clears all traces and blocks relay resurrection", () => {
      const store = createTestStore();

      // Establish friendship
      store.dispatch(addFriendRequest(makeRequest({
        id: "w-in", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      expect(store.getState().friendRequests.requests[0].status).toBe("accepted");

      // Unfriend
      store.dispatch(removeFriend(marcusCole.pubkey));
      expect(store.getState().friendRequests.requests).toHaveLength(0);
      expect(store.getState().friendRequests.removedPubkeys).toContain(marcusCole.pubkey);
    });

    it("relay re-delivery of old accepted request is blocked by removedPubkeys", () => {
      const store = createTestStore();

      // Establish and then remove friendship
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      store.dispatch(removeFriend(marcusCole.pubkey));

      // removedPubkeys prevents resurrection via addFriendRequest
      // (the actual resurrection guard is in eventPipeline, but removedPubkeys is the data it checks)
      expect(store.getState().friendRequests.removedPubkeys).toContain(marcusCole.pubkey);
      expect(store.getState().friendRequests.requests).toHaveLength(0);
    });
  });

  describe("re-friend flow (friend → unfriend → friend again)", () => {
    it("clearRemovedPubkey allows new request after unfriend", () => {
      const store = createTestStore();

      // Establish friendship
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));

      // Unfriend
      store.dispatch(removeFriend(marcusCole.pubkey));
      expect(store.getState().friendRequests.removedPubkeys).toContain(marcusCole.pubkey);

      // Re-friend: clear the block, send new request
      store.dispatch(clearRemovedPubkey(marcusCole.pubkey));
      expect(store.getState().friendRequests.removedPubkeys).not.toContain(marcusCole.pubkey);

      store.dispatch(addFriendRequest(makeRequest({
        id: "w2", pubkey: marcusCole.pubkey, direction: "outgoing",
      })));
      const reqs = store.getState().friendRequests.requests;
      expect(reqs).toHaveLength(1);
      expect(reqs[0].status).toBe("pending");
      expect(reqs[0].direction).toBe("outgoing");
    });
  });

  describe("cancel outgoing → re-send flow", () => {
    it("cancelled request can be re-sent after clearing removed", () => {
      const store = createTestStore();

      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing",
      })));
      store.dispatch(cancelFriendRequest(marcusCole.pubkey));
      expect(store.getState().friendRequests.requests).toHaveLength(0);

      // Clear and re-send
      store.dispatch(clearRemovedPubkey(marcusCole.pubkey));
      store.dispatch(addFriendRequest(makeRequest({
        id: "w2", pubkey: marcusCole.pubkey, direction: "outgoing",
      })));
      expect(store.getState().friendRequests.requests).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════
  // Follow list ↔ friend request interplay
  // ═══════════════════════════════════════════════

  describe("follow/unfollow impact on friend status derivation", () => {
    /**
     * useFriends() returns pubkeys that are BOTH in followList AND have
     * an accepted friend request. These tests verify the Redux state that
     * drives that derivation.
     */

    it("accepted friend request + following = friend (happy path)", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));

      // Accept friend request
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));

      // Follow them (as auto-follow does)
      store.dispatch(setFollowList({ follows: [marcusCole.pubkey], createdAt: 100 }));

      // Verify: accepted + in follow list
      const state = store.getState();
      const acceptedReq = state.friendRequests.requests.find(
        (r) => r.pubkey === marcusCole.pubkey && r.status === "accepted",
      );
      expect(acceptedReq).toBeDefined();
      expect(state.identity.followList).toContain(marcusCole.pubkey);
    });

    it("accepted friend request but NOT following = not a friend", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));

      // Accept friend request but don't follow
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      store.dispatch(setFollowList({ follows: [], createdAt: 100 }));

      // Accepted but not in follow list — useFriends() would exclude them
      const state = store.getState();
      expect(state.identity.followList).not.toContain(marcusCole.pubkey);
    });

    it("following someone with no friend request = not a friend", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));
      store.dispatch(setFollowList({ follows: [marcusCole.pubkey], createdAt: 100 }));

      // In follow list but no friend request
      const state = store.getState();
      expect(state.identity.followList).toContain(marcusCole.pubkey);
      expect(state.friendRequests.requests).toHaveLength(0);
    });

    it("unfollowing a friend breaks the friend derivation", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));

      // Establish friendship
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      store.dispatch(setFollowList({ follows: [marcusCole.pubkey], createdAt: 100 }));

      // Unfollow — remove from follow list
      store.dispatch(setFollowList({ follows: [], createdAt: 200 }));

      // Friend request still accepted, but no longer following
      const state = store.getState();
      expect(state.friendRequests.requests[0].status).toBe("accepted");
      expect(state.identity.followList).not.toContain(marcusCole.pubkey);
    });

    it("removeFriend + unfollow clears both friend state and follow list", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));

      // Full friendship
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      store.dispatch(setFollowList({
        follows: [marcusCole.pubkey, sageNakamura.pubkey],
        createdAt: 100,
      }));

      // Unfriend: removeFriend clears request state, unfollow removes from follow list
      store.dispatch(removeFriend(marcusCole.pubkey));
      store.dispatch(setFollowList({ follows: [sageNakamura.pubkey], createdAt: 200 }));

      const state = store.getState();
      expect(state.friendRequests.requests).toHaveLength(0);
      expect(state.identity.followList).toEqual([sageNakamura.pubkey]);
      expect(state.friendRequests.removedPubkeys).toContain(marcusCole.pubkey);
    });
  });

  describe("wouldBreakFriendship derivation", () => {
    /**
     * wouldBreakFriendship checks: requests.some(r => r.pubkey === pk && r.status === "accepted")
     * These tests verify the state that feeds that check.
     */

    it("returns true when there is an accepted request for the pubkey", () => {
      const store = createTestStore();
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));

      const hasAccepted = store.getState().friendRequests.requests.some(
        (r) => r.pubkey === marcusCole.pubkey && r.status === "accepted",
      );
      expect(hasAccepted).toBe(true);
    });

    it("returns false when request is only pending", () => {
      const store = createTestStore();
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing",
      })));

      const hasAccepted = store.getState().friendRequests.requests.some(
        (r) => r.pubkey === marcusCole.pubkey && r.status === "accepted",
      );
      expect(hasAccepted).toBe(false);
    });

    it("returns false after removeFriend", () => {
      const store = createTestStore();
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      store.dispatch(removeFriend(marcusCole.pubkey));

      const hasAccepted = store.getState().friendRequests.requests.some(
        (r) => r.pubkey === marcusCole.pubkey && r.status === "accepted",
      );
      expect(hasAccepted).toBe(false);
    });
  });

  describe("multi-user scenarios", () => {
    it("independent friend requests from different users don't interfere", () => {
      const store = createTestStore();

      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(addFriendRequest(makeRequest({
        id: "w2", pubkey: sageNakamura.pubkey, direction: "incoming",
      })));

      // Accept Marcus, decline Sage
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      store.dispatch(declineFriendRequest(sageNakamura.pubkey));

      const reqs = store.getState().friendRequests.requests;
      expect(reqs.find((r) => r.pubkey === marcusCole.pubkey)?.status).toBe("accepted");
      expect(reqs.find((r) => r.pubkey === sageNakamura.pubkey)?.status).toBe("declined");
    });

    it("removing one friend does not affect another", () => {
      const store = createTestStore();

      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "incoming",
      })));
      store.dispatch(addFriendRequest(makeRequest({
        id: "w2", pubkey: sageNakamura.pubkey, direction: "incoming",
      })));
      store.dispatch(acceptFriendRequest(marcusCole.pubkey));
      store.dispatch(acceptFriendRequest(sageNakamura.pubkey));

      // Remove Marcus only
      store.dispatch(removeFriend(marcusCole.pubkey));

      const reqs = store.getState().friendRequests.requests;
      expect(reqs).toHaveLength(1);
      expect(reqs[0].pubkey).toBe(sageNakamura.pubkey);
      expect(reqs[0].status).toBe("accepted");
    });

    it("cross-request: outgoing to A and incoming from B are independent", () => {
      const store = createTestStore();
      store.dispatch(addFriendRequest(makeRequest({
        id: "w1", pubkey: marcusCole.pubkey, direction: "outgoing",
      })));
      store.dispatch(addFriendRequest(makeRequest({
        id: "w2", pubkey: sageNakamura.pubkey, direction: "incoming",
      })));

      // Cancel outgoing to Marcus
      store.dispatch(cancelFriendRequest(marcusCole.pubkey));

      // Sage's incoming request still intact
      const reqs = store.getState().friendRequests.requests;
      expect(reqs).toHaveLength(1);
      expect(reqs[0].pubkey).toBe(sageNakamura.pubkey);
    });
  });

  describe("follow list safety guard interplay", () => {
    /**
     * follow.ts guards: if followList.length === 0 && followListCreatedAt === 0, throws.
     * These tests verify the Redux state conditions that would trigger or avoid that guard,
     * particularly around friend actions that call followUser/unfollowUser.
     */

    it("follow list loaded from cache (createdAt 0) allows follow actions", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));

      // Cache load: follows exist, createdAt is 0
      store.dispatch(setFollowList({ follows: [sageNakamura.pubkey], createdAt: 0 }));

      // Guard condition: length > 0, so it passes regardless of createdAt
      const state = store.getState().identity;
      expect(state.followList.length).toBeGreaterThan(0);
    });

    it("follow list loaded from relay (createdAt > 0) allows follow actions even if empty", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));

      // Relay confirms empty list (new user)
      store.dispatch(setFollowList({ follows: [], createdAt: 1 }));

      // Guard condition: createdAt > 0, so it passes even with empty list
      const state = store.getState().identity;
      expect(state.followListCreatedAt).toBeGreaterThan(0);
    });

    it("completely unloaded follow list blocks follow actions", () => {
      const store = createTestStore();
      store.dispatch(login({ pubkey: lunaVega.pubkey, signerType: "nip07" }));

      // No cache, no relay response yet
      const state = store.getState().identity;
      expect(state.followList).toEqual([]);
      expect(state.followListCreatedAt).toBe(0);
      // This is the guard condition: length === 0 && createdAt === 0
    });
  });
});
