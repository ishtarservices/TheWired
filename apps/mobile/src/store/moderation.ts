// Moderation thunks — mutate the slice AND persist through the
// StorageAdapter (user_state store; per-account DB when logged in, app DB
// for guests — same resolution as everything else).

import type { AppThunk } from "@/store";
import {
  eventReported,
  moderationHydrated,
  userMuted,
  userUnmuted,
} from "./slices/moderationSlice";

const MUTED_KEY = "moderation.muted";
const REPORTED_KEY = "moderation.reported";

export function hydrateModeration(): AppThunk<Promise<void>> {
  return async (dispatch, _getState, { adapters }) => {
    try {
      const store = adapters.storage.getStore<string[]>("user_state");
      const [muted, reported] = await Promise.all([
        store.get(MUTED_KEY),
        store.get(REPORTED_KEY),
      ]);
      dispatch(
        moderationHydrated({
          mutedPubkeys: muted ?? [],
          reportedEventIds: reported ?? [],
        }),
      );
    } catch {
      // fresh device — nothing to hydrate
    }
  };
}

export function blockUser(pubkey: string): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    dispatch(userMuted(pubkey));
    const muted = Object.keys(getState().moderation.mutedPubkeys);
    await adapters.storage
      .getStore<string[]>("user_state")
      .put(MUTED_KEY, muted)
      .catch(() => {});
  };
}

export function unblockUser(pubkey: string): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    dispatch(userUnmuted(pubkey));
    const muted = Object.keys(getState().moderation.mutedPubkeys);
    await adapters.storage
      .getStore<string[]>("user_state")
      .put(MUTED_KEY, muted)
      .catch(() => {});
  };
}

/** Report stub: queued locally so the UI reflects it (kind-1984 / backend
 *  reporting path lands with the moderation phase). */
export function reportEvent(eventId: string): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    dispatch(eventReported(eventId));
    const reported = Object.keys(getState().moderation.reportedEventIds);
    await adapters.storage
      .getStore<string[]>("user_state")
      .put(REPORTED_KEY, reported)
      .catch(() => {});
  };
}
