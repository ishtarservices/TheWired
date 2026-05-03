import type { AppDispatch } from "../../store";
import { store } from "../../store";
import { removeSpace } from "../../store/slices/spacesSlice";
import { leaveClientSpace, closeBgChatSub } from "../../lib/nostr/groupSubscriptions";
import { removeSpaceFromStore } from "../../lib/db/spaceStore";
import { clearSpaceUnread } from "../../store/slices/notificationSlice";
import { clearFeedMeta } from "../../store/slices/feedSlice";
import { clearSpaceFeed } from "../../store/slices/eventsSlice";
import { removeMembers as removeMembersFromIDB } from "../../lib/db/spaceMembersStore";
import { removeLastChannel } from "../../lib/db/lastChannelCache";

/**
 * Unified cleanup for all slices + IDB stores when a space is gone — used by
 * `useSpace` for "space deleted on backend" 404s, and by `kickHandler` for
 * "you were removed from this space" relay rejections. Both paths converge
 * on the same teardown sequence.
 */
export function cleanupSpaceState(spaceId: string, dispatch: AppDispatch): void {
  leaveClientSpace(spaceId);
  closeBgChatSub(spaceId);

  const spaceChannels = store.getState().spaces.channels[spaceId];
  if (spaceChannels) {
    for (const ch of spaceChannels) {
      dispatch(clearFeedMeta(`${spaceId}:${ch.id}`));
    }
  }
  dispatch(clearFeedMeta(`${spaceId}:notes`));
  dispatch(clearFeedMeta(`${spaceId}:media`));
  dispatch(clearFeedMeta(`${spaceId}:articles`));
  dispatch(clearFeedMeta(`${spaceId}:music`));

  dispatch(removeSpace(spaceId));
  dispatch(clearSpaceUnread(spaceId));
  dispatch(clearSpaceFeed(spaceId));
  removeSpaceFromStore(spaceId);
  removeMembersFromIDB(spaceId).catch(() => {/* best-effort */});
  removeLastChannel(spaceId);
}
