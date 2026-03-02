import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";

/**
 * Returns the list of "true friend" pubkeys.
 *
 * A friend must satisfy BOTH:
 * 1. Accepted friend request (either direction)
 * 2. You follow them (followList)
 *
 * We no longer require knownFollowers confirmation because:
 * - knownFollowers depends on relay availability and is often incomplete at startup
 * - Accepting a friend request auto-follows in both directions, so mutual follow
 *   is effectively guaranteed after acceptance
 * - The accept flow now syncs knownFollowers explicitly, but we don't gate on it
 *   to avoid the "empty friends list on load" bug
 *
 * The profile page "Friends" badge still uses useMutualFollow() for live relay
 * verification on a per-user basis.
 */
export function useFriends(): string[] {
  const followList = useAppSelector((s) => s.identity.followList);
  const friendRequests = useAppSelector((s) => s.friendRequests.requests);

  return useMemo(() => {
    // Build a set of pubkeys with accepted friend requests
    const acceptedFriendPubkeys = new Set<string>();
    for (const r of friendRequests) {
      if (r.status === "accepted") {
        acceptedFriendPubkeys.add(r.pubkey);
      }
    }

    // Friend = accepted friend request + you follow them
    return followList.filter((pk) => acceptedFriendPubkeys.has(pk));
  }, [followList, friendRequests]);
}
