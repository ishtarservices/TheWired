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

  // GUARD: Refuse to publish kind:3 if the follow list hasn't been loaded yet.
  // Without this, a follow action before relay data arrives would publish a
  // kind:3 with only the new follow, permanently wiping the real contact list.
  if (currentFollows.length === 0 && prevCreatedAt === 0) {
    throw new Error("Follow list not yet loaded from relays — cannot safely publish kind:3");
  }

  const newFollows = [...currentFollows, targetPubkey];
  const now = Math.floor(Date.now() / 1000);

  // Optimistic update
  store.dispatch(setFollowList({ follows: newFollows, createdAt: now }));

  try {
    const unsigned = buildFollowListEvent(myPubkey, newFollows);
    await signAndPublish(unsigned);
  } catch (err) {
    // Rollback: restore previous follow list. Use `now` (the optimistic
    // timestamp), NOT prevCreatedAt — setFollowList's freshness guard is
    // strict `<`, so restoring with the older createdAt would be silently
    // dropped and the optimistic follow would stick.
    console.error("[Follow] Publish failed, rolling back:", err);
    store.dispatch(setFollowList({ follows: currentFollows, createdAt: now }));
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

  // GUARD: Refuse to publish kind:3 if the follow list hasn't been loaded yet.
  if (currentFollows.length <= 1 && prevCreatedAt === 0) {
    throw new Error("Follow list not yet loaded from relays — cannot safely publish kind:3");
  }

  const newFollows = currentFollows.filter((pk) => pk !== targetPubkey);
  const now = Math.floor(Date.now() / 1000);

  // Optimistic update
  store.dispatch(setFollowList({ follows: newFollows, createdAt: now }));

  try {
    const unsigned = buildFollowListEvent(myPubkey, newFollows);
    await signAndPublish(unsigned);
  } catch (err) {
    // Rollback: restore previous follow list. Use `now` (the optimistic
    // timestamp), NOT prevCreatedAt — setFollowList's freshness guard is
    // strict `<`, so restoring with the older createdAt would be silently
    // dropped and the optimistic unfollow would stick.
    console.error("[Unfollow] Publish failed, rolling back:", err);
    store.dispatch(setFollowList({ follows: currentFollows, createdAt: now }));
    throw err;
  }
}
