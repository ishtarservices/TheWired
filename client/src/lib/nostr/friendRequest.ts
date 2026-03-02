import { createGiftWrappedDM, createSelfWrap } from "./giftWrap";
import { relayManager } from "./relayManager";
import { store } from "@/store";
import {
  addFriendRequest,
  acceptFriendRequest,
  markOutgoingAccepted,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  clearRemovedPubkey,
} from "@/store/slices/friendRequestSlice";
import { addKnownFollower } from "@/store/slices/identitySlice";
import { followUser, unfollowUser } from "./follow";

/**
 * Send a friend request to a user via gift-wrapped DM.
 *
 * Auto-accept: If there's already a pending incoming request from this pubkey,
 * we accept it instead of sending a new outgoing request.
 *
 * Dedup: If there's already a pending outgoing to this pubkey, returns early.
 */
export async function sendFriendRequest(
  recipientPubkey: string,
  message?: string,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  const { requests, removedPubkeys } = store.getState().friendRequests;

  // Clear from removed list so this pubkey can be re-friended
  if (removedPubkeys.includes(recipientPubkey)) {
    store.dispatch(clearRemovedPubkey(recipientPubkey));
  }

  // Auto-accept: if they already sent us a request, accept it instead
  const pendingIncoming = requests.find(
    (r) =>
      r.pubkey === recipientPubkey &&
      r.direction === "incoming" &&
      r.status === "pending",
  );
  if (pendingIncoming) {
    await acceptFriendRequestAction(recipientPubkey);
    return;
  }

  // Dedup: if we already have a pending outgoing to this pubkey, skip
  const pendingOutgoing = requests.find(
    (r) =>
      r.pubkey === recipientPubkey &&
      r.direction === "outgoing" &&
      r.status === "pending",
  );
  if (pendingOutgoing) return;

  const content = message ?? "";
  const extraTags: string[][] = [["type", "friend_request"]];

  // Create gift wrap for recipient
  const recipientWrap = await createGiftWrappedDM(content, recipientPubkey, extraTags);

  // Create gift wrap for self
  const selfWrap = await createSelfWrap(content, recipientPubkey, extraTags);

  // Publish both
  relayManager.publish(recipientWrap);
  relayManager.publish(selfWrap);

  // Optimistic local dispatch
  store.dispatch(
    addFriendRequest({
      id: selfWrap.id,
      pubkey: recipientPubkey,
      message: content,
      createdAt: Math.round(Date.now() / 1000),
      status: "pending",
      direction: "outgoing",
    }),
  );
}

/**
 * Accept an incoming friend request.
 * Sends an accept gift wrap, updates local state, and auto-follows.
 * Also syncs knownFollowers to ensure the friend appears in useFriends().
 */
export async function acceptFriendRequestAction(
  requesterPubkey: string,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  // Clear from removed list if previously unfriended
  const { removedPubkeys } = store.getState().friendRequests;
  if (removedPubkeys.includes(requesterPubkey)) {
    store.dispatch(clearRemovedPubkey(requesterPubkey));
  }

  const extraTags: string[][] = [["type", "friend_request_accept"]];

  // Create gift wraps for requester and self
  const recipientWrap = await createGiftWrappedDM("", requesterPubkey, extraTags);
  const selfWrap = await createSelfWrap("", requesterPubkey, extraTags);

  // Publish both
  relayManager.publish(recipientWrap);
  relayManager.publish(selfWrap);

  // Update local state
  store.dispatch(acceptFriendRequest(requesterPubkey));
  store.dispatch(markOutgoingAccepted(requesterPubkey));

  // Sync knownFollowers: they sent us a request, so they clearly know us.
  // This ensures useFriends() works immediately without waiting for relay follower queries.
  store.dispatch(addKnownFollower(requesterPubkey));

  // Auto-follow: friending implies following
  const currentFollows = store.getState().identity.followList;
  if (!currentFollows.includes(requesterPubkey)) {
    try {
      await followUser(requesterPubkey);
    } catch (err) {
      console.error("[FriendRequest] Auto-follow failed after accept:", err);
      // Don't revert the accept — the friendship is valid, follow can be retried
    }
  }
}

/**
 * Decline a friend request. Local-only — no event sent.
 */
export function declineFriendRequestAction(pubkey: string): void {
  store.dispatch(declineFriendRequest(pubkey));
}

/**
 * Cancel (unsend) a pending outgoing friend request.
 * Local-only — the gift wrap already sent to the relay cannot be retracted,
 * but removing local state resets the UI so the user can re-send later.
 */
export function cancelFriendRequestAction(pubkey: string): void {
  store.dispatch(cancelFriendRequest(pubkey));
}

/**
 * Remove a friend. Sends a remove notification wrap, auto-unfollows, then clears local state.
 * The remove wrap uses the same kind:1059 gift-wrap infrastructure so no relay changes needed.
 */
export async function removeFriendAction(pubkey: string): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  // Send remove notification to the other user so their client can sync
  try {
    const extraTags: string[][] = [["type", "friend_request_remove"]];
    const recipientWrap = await createGiftWrappedDM("", pubkey, extraTags);
    const selfWrap = await createSelfWrap("", pubkey, extraTags);
    relayManager.publish(recipientWrap);
    relayManager.publish(selfWrap);
  } catch (err) {
    console.error("[FriendRequest] Failed to send remove wrap:", err);
    // Still proceed with local removal
  }

  // Unfollow
  const currentFollows = store.getState().identity.followList;
  if (currentFollows.includes(pubkey)) {
    try {
      await unfollowUser(pubkey);
    } catch (err) {
      console.error("[FriendRequest] Unfollow failed during unfriend:", err);
    }
  }

  // Remove friend request state (also adds to removedPubkeys to prevent relay resurrection)
  store.dispatch(removeFriend(pubkey));
}

/**
 * Check if unfollowing this pubkey would break a friendship.
 * Used by UI to show a confirmation dialog.
 */
export function wouldBreakFriendship(pubkey: string): boolean {
  const { requests } = store.getState().friendRequests;
  return requests.some(
    (r) => r.pubkey === pubkey && r.status === "accepted",
  );
}
