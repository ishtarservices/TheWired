import { store } from "@/store";
import { setFollowList } from "@/store/slices/identitySlice";
import { buildFollowListEvent } from "./eventBuilder";
import { signAndPublish } from "./publish";

/** Follow a user: appends to follow list, publishes kind:3.
 *  Rolls back optimistic update if publish fails. */
export async function followUser(targetPubkey: string): Promise<void> {
  const state = store.getState();
  const myPubkey = state.identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  const currentFollows = state.identity.followList;
  const prevCreatedAt = state.identity.followListCreatedAt;
  if (currentFollows.includes(targetPubkey)) return;

  const newFollows = [...currentFollows, targetPubkey];
  const now = Math.floor(Date.now() / 1000);

  // Optimistic update
  store.dispatch(setFollowList({ follows: newFollows, createdAt: now }));

  try {
    const unsigned = buildFollowListEvent(myPubkey, newFollows);
    await signAndPublish(unsigned);
  } catch (err) {
    // Rollback: restore previous follow list
    console.error("[Follow] Publish failed, rolling back:", err);
    store.dispatch(setFollowList({ follows: currentFollows, createdAt: prevCreatedAt }));
    throw err;
  }
}

/** Unfollow a user: removes from follow list, publishes kind:3.
 *  Rolls back optimistic update if publish fails. */
export async function unfollowUser(targetPubkey: string): Promise<void> {
  const state = store.getState();
  const myPubkey = state.identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  const currentFollows = state.identity.followList;
  const prevCreatedAt = state.identity.followListCreatedAt;
  if (!currentFollows.includes(targetPubkey)) return;

  const newFollows = currentFollows.filter((pk) => pk !== targetPubkey);
  const now = Math.floor(Date.now() / 1000);

  // Optimistic update
  store.dispatch(setFollowList({ follows: newFollows, createdAt: now }));

  try {
    const unsigned = buildFollowListEvent(myPubkey, newFollows);
    await signAndPublish(unsigned);
  } catch (err) {
    // Rollback: restore previous follow list
    console.error("[Unfollow] Publish failed, rolling back:", err);
    store.dispatch(setFollowList({ follows: currentFollows, createdAt: prevCreatedAt }));
    throw err;
  }
}
