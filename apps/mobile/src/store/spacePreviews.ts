// Space-preview thunks — mutate the slice AND persist the read-state map
// through the StorageAdapter (user_state store; per-account DB when logged
// in, app DB for guests — the moderation.ts pattern). Previews themselves
// are session-only and never persist.

import type { AppThunk } from "@/store";
import {
  channelKey,
  channelMarkedRead,
  spaceLastReadHydrated,
} from "./slices/spacePreviewsSlice";

const LAST_READ_KEY = "spaces.lastReadAt";

export function hydrateSpacePreviews(): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    try {
      const stored = await adapters.storage
        .getStore<Record<string, number>>("user_state")
        .get(LAST_READ_KEY);
      if (stored && typeof stored === "object") {
        dispatch(spaceLastReadHydrated(stored));
      } else {
        dispatch(spaceLastReadHydrated({}));
      }
    } catch {
      // fresh device — nothing to hydrate
    }
  };
}

export function markChannelRead(spaceId: string, channelId: string): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    // Clock-skew guard: a peer whose clock runs ahead posts created_at >
    // device-now; stamping device time alone would keep that message unread
    // forever. Being in the channel means everything currently present was
    // seen — advance to the newest seen event when it's ahead of the clock.
    const now = Math.floor(Date.now() / 1000);
    const preview = getState().spacePreviews.previews[channelKey(spaceId, channelId)];
    const at = Math.max(now, preview?.lastEventAt ?? 0);
    dispatch(channelMarkedRead({ spaceId, channelId, at }));
    await adapters.storage
      .getStore<Record<string, number>>("user_state")
      .put(LAST_READ_KEY, getState().spacePreviews.lastReadAt)
      .catch(() => {});
  };
}
