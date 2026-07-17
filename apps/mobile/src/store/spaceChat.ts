// Space-chat cache thunks — hydrate a channel's stored kind-9 backlog into
// the slice and write it back through the StorageAdapter (space_chat store;
// per-account DB when logged in, app DB for guests — the spacePreviews.ts
// pattern). Writes are immediate; ChannelScreen owns the debounce so no
// module-level timer state leaks across identities.

import type { NostrEvent } from "@thewired/shared-types";

import type { AppThunk } from "@/store";
import { channelKey } from "./slices/spacePreviewsSlice";
import {
  channelBacklogHydrated,
  spaceBacklogPurged,
} from "./slices/spaceChatSlice";

/** Newest events persisted per channel row (screen backlog REQ is 60). */
export const PERSIST_PER_CHANNEL = 60;

export function hydrateChannelBacklog(
  spaceId: string,
  channelId: string,
): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    const key = channelKey(spaceId, channelId);
    if (getState().spaceChat.hydrated[key]) return;
    let events: NostrEvent[] = [];
    try {
      const stored = await adapters.storage
        .getStore<NostrEvent[]>("space_chat")
        .get(key);
      if (Array.isArray(stored)) {
        events = stored.filter(
          (e) => !!e && typeof e.id === "string" && typeof e.created_at === "number",
        );
      }
    } catch {
      // corrupt row / fresh device — hydrate empty; the live sub rebuilds
    }
    dispatch(channelBacklogHydrated({ spaceId, channelId, events }));
  };
}

export function persistChannelBacklog(
  spaceId: string,
  channelId: string,
): AppThunk<Promise<void>> {
  return async (_dispatch, getState, { adapters }) => {
    const events = getState().spaceChat.byChannel[channelKey(spaceId, channelId)];
    // Empty-guard doubles as the identity-switch valve: spaceChatCleared
    // fires before the account DB swap, so a late unmount flush sees an
    // empty slice and no-ops instead of writing into the next account's DB.
    if (!events || events.length === 0) return;
    await adapters.storage
      .getStore<NostrEvent[]>("space_chat")
      .put(channelKey(spaceId, channelId), events.slice(-PERSIST_PER_CHANNEL))
      .catch(() => {});
  };
}

export function purgeSpaceChat(spaceId: string): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    dispatch(spaceBacklogPurged(spaceId));
    try {
      const store = adapters.storage.getStore<NostrEvent[]>("space_chat");
      const keys = await store.getAllKeys();
      for (const key of keys) {
        if (key.startsWith(`${spaceId}/`)) await store.delete(key);
      }
    } catch {
      // best-effort — a stale row only costs one overwrite later
    }
  };
}
