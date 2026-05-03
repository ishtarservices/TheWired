import { store } from "../../store";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { syncSpaceMembers } from "../../store/thunks/spaceMembers";
import { addNotification } from "../../store/slices/notificationSlice";
import { cleanupSpaceState } from "../../features/spaces/spaceCleanup";

/**
 * Pattern matching the relay's publish-gate rejection reason. The relay
 * (services/relay/src/nostr/membership_gate.rs) returns
 * `"auth-required: not a member of this group"` when a kicked user tries to
 * post an h-tagged event. Other `auth-required:` rejections (e.g. NIP-42
 * pre-AUTH) must NOT trigger this — hence the explicit "not a member" check.
 */
const KICKED_RE = /^auth-required:.*not a member/i;

/**
 * Reactive handler for the "you were kicked" relay rejection.
 *
 * Wired into the global `onOK` callback in `loginFlow.wireRelayStatusBridge`.
 * When a publish is rejected because we're no longer in `app.space_members`:
 *
 *   1. Resolve the rejected event by id → its h-tag → spaceId.
 *   2. Refetch authoritative membership via `syncSpaceMembers`.
 *   3. If our pubkey is no longer in the member list, run the same cleanup
 *      path that handles "space deleted on backend" (`cleanupSpaceState`)
 *      and emit an in-app notification.
 *
 * If the membership refetch *does* still include us (rare race: server lag,
 * or we were re-added between publish and rejection), bail out so we don't
 * remove a space the user is actually in.
 */
export async function handlePotentialKick(
  eventId: string,
  success: boolean,
  message: string,
): Promise<void> {
  if (success) return;
  if (!KICKED_RE.test(message)) return;

  const event = eventsSelectors.selectById(store.getState().events, eventId);
  if (!event) return;

  const spaceId = event.tags.find((t) => t[0] === "h")?.[1];
  if (!spaceId) return;

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  try {
    await store.dispatch(syncSpaceMembers(spaceId));
  } catch {
    // Network / 4xx — fall through and decide based on current state.
  }

  const stillMember = store
    .getState()
    .spaceConfig.members[spaceId]?.some((m) => m.pubkey === myPubkey);
  if (stillMember) return;

  const space = store.getState().spaces.list.find((s) => s.id === spaceId);
  const spaceName = space?.name ?? "this space";

  cleanupSpaceState(spaceId, store.dispatch);

  store.dispatch(
    addNotification({
      id: `kicked-${spaceId}-${Date.now()}`,
      type: "chat",
      title: "Removed from space",
      body: `You are no longer a member of ${spaceName}.`,
      timestamp: Math.floor(Date.now() / 1000),
    }),
  );
}
