/**
 * In-app notification for "a saved track / project has a new version".
 *
 * Gated by the user's notification preferences (`musicUpdates`, default on) like
 * every other type, deduped per (item, version) through `addNotification`'s id
 * check and the dismissed-id list, and never fired for the user's own releases.
 */
import type { RootState } from "@/store";
import type { InAppNotification } from "@/store/slices/notificationSlice";
import { kindOf } from "./savedVersions";

export interface MusicUpdateCandidate {
  addressableId: string;
  /** Author of the track / project. */
  authorPubkey: string;
  title: string;
  /** Display label for the artist (already resolved, or the raw field). */
  artist?: string;
  eventId: string;
  createdAt: number;
}

export function musicUpdateNotificationId(addressableId: string, eventId: string): string {
  return `music-update-${addressableId}-${eventId}`;
}

/**
 * Decide whether to notify for this candidate and build the notification.
 * Returns null when preferences, DND, or ownership say no. Pure: the caller
 * dispatches (and fires the OS notification if `browserNotifications` is on).
 */
export function planMusicUpdateNotification(
  state: Pick<RootState, "identity" | "notifications">,
  c: MusicUpdateCandidate,
): InAppNotification | null {
  const me = state.identity.pubkey;
  if (!me || c.authorPubkey === me) return null;

  const prefs = state.notifications.preferences;
  if (!prefs.enabled || !prefs.musicUpdates) return null;
  if (prefs.dnd && (!prefs.dndUntil || prefs.dndUntil > Date.now())) return null;

  if (state.identity.muteList.some((m) => m.type === "pubkey" && m.value === c.authorPubkey)) {
    return null;
  }

  const noun = kindOf(c.addressableId) === 33123 ? "project" : "track";
  const who = c.artist?.trim() ? c.artist.trim() : "The artist";
  return {
    id: musicUpdateNotificationId(c.addressableId, c.eventId),
    type: "music_update",
    title: `${c.title} was updated`,
    body: `${who} released a new version of this ${noun}.`,
    actorPubkey: c.authorPubkey,
    contextId: c.addressableId,
    timestamp: Date.now(),
  };
}
