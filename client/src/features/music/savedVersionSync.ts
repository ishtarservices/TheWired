/**
 * Saved-version sync: one place that talks to `/music/save-version`,
 * `/music/saved-updates` and `/music/acknowledge-update`, keeps Redux in step,
 * asks relays for versions the ingester saw before the client did, and raises
 * the "updated" notification (WIR-165).
 *
 * Module-level (not per-component) so the whole app shares one throttled
 * fetch instead of every album detail re-fetching on mount.
 */
import { store } from "@/store";
import { setSavedVersions, setSavedVersion, clearSavedVersion } from "@/store/slices/musicSlice";
import { addNotification } from "@/store/slices/notificationSlice";
import type { SavedAlbumVersion } from "@/types/music";
import { getApiBaseUrl } from "@/lib/api/client";
import { buildNip98Header } from "@/lib/api/nip98";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "@/lib/nostr/constants";
import { showBrowserNotification } from "@/features/notifications/browserNotify";
import { buildVersionFilters, hasPendingUpdate, needsFetch, newestKnownVersion } from "./savedVersions";
import { planMusicUpdateNotification } from "./musicUpdateNotifier";

/** Don't hit the backend more often than this unless forced. */
const SYNC_MIN_INTERVAL_MS = 60_000;

let lastSyncAt = 0;
let lastSyncPubkey: string | null = null;
let inFlight: Promise<void> | null = null;

function currentItem(addressableId: string) {
  const music = store.getState().music;
  return music.albums[addressableId] ?? music.tracks[addressableId];
}

async function authed(url: string, method: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Authorization: await buildNip98Header(url, method) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function rowFromApi(raw: Record<string, unknown>): SavedAlbumVersion | null {
  if (typeof raw.addressableId !== "string" || typeof raw.savedEventId !== "string") return null;
  return {
    addressableId: raw.addressableId,
    savedEventId: raw.savedEventId,
    savedCreatedAt: Number(raw.savedCreatedAt),
    hasUpdate: raw.hasUpdate === true,
    latestEventId: typeof raw.latestEventId === "string" ? raw.latestEventId : null,
    latestCreatedAt: typeof raw.latestCreatedAt === "number" ? raw.latestCreatedAt : null,
  };
}

/**
 * Raise the in-app notification for a saved item whose newer version we now
 * know about. Safe to call repeatedly: the id is per (item, version).
 */
export function notifyMusicUpdate(addressableId: string): void {
  const state = store.getState();
  const saved = state.music.savedVersions[addressableId];
  const current = currentItem(addressableId);
  if (!saved || !hasPendingUpdate(saved, current)) return;

  const newest = newestKnownVersion(saved, current);
  const authorPubkey = current?.pubkey ?? addressableId.split(":")[1] ?? "";
  const notif = planMusicUpdateNotification(state, {
    addressableId,
    authorPubkey,
    title: current?.title ?? "A saved item",
    artist: current?.artist,
    eventId: newest.eventId,
    createdAt: newest.createdAt,
  });
  if (!notif) return;

  const before = state.notifications.notifications.length;
  store.dispatch(addNotification(notif));
  // Only fire the OS notification when this was genuinely new (not deduped).
  const after = store.getState().notifications;
  if (after.notifications.length > before && after.preferences.browserNotifications) {
    showBrowserNotification(notif.title, notif.body);
  }
}

/** Ask relays for the versions the ingester saw but the client doesn't hold. */
function fetchMissingVersions(rows: SavedAlbumVersion[]): void {
  const wanted = rows
    .filter((r) => needsFetch(r, currentItem(r.addressableId)))
    .map((r) => ({ addressableId: r.addressableId, since: r.savedCreatedAt + 1 }));
  if (wanted.length === 0) return;
  void subscriptionManager.subscribeOnce({ filters: buildVersionFilters(wanted), relayUrls: PROFILE_RELAYS });
}

/**
 * Pull every saved version from the backend (throttled; deduped while in
 * flight), fetch versions we're missing, and notify for pending updates.
 */
export function syncSavedVersions(opts: { force?: boolean } = {}): Promise<void> {
  const pubkey = store.getState().identity.pubkey;
  if (!pubkey) return Promise.resolve();
  if (inFlight) return inFlight;
  const stale = pubkey !== lastSyncPubkey || Date.now() - lastSyncAt > SYNC_MIN_INTERVAL_MS;
  if (!opts.force && !stale) return Promise.resolve();

  inFlight = (async () => {
    try {
      const url = `${getApiBaseUrl()}/music/saved-updates`;
      const res = await authed(url, "GET");
      if (!res.ok) return;
      const json = (await res.json()) as { data?: unknown };
      if (!Array.isArray(json.data)) return;

      const rows = json.data.map((r) => rowFromApi(r as Record<string, unknown>)).filter((r): r is SavedAlbumVersion => r !== null);
      const map: Record<string, SavedAlbumVersion> = {};
      for (const r of rows) map[r.addressableId] = r;
      // Identity may have changed while the request was in flight.
      if (store.getState().identity.pubkey !== pubkey) return;
      store.dispatch(setSavedVersions(map));
      lastSyncAt = Date.now();
      lastSyncPubkey = pubkey;

      fetchMissingVersions(rows);
      for (const r of rows) notifyMusicUpdate(r.addressableId);
      void backfillLibraryVersions(map);
    } catch {
      // Offline / backend down: keep whatever we had.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * At login: ask relays for anything newer than the saved items we already hold,
 * so a release while we were offline reaches Redux (and the banner) even if
 * the backend ingester never saw it.
 */
export function watchSavedItemsForUpdates(addressableIds: string[]): void {
  const music = store.getState().music;
  const items = addressableIds
    .map((id) => ({ id, current: music.albums[id] ?? music.tracks[id] }))
    .filter((x) => x.current && x.current.pubkey !== store.getState().identity.pubkey)
    .map((x) => ({ addressableId: x.id, since: x.current!.createdAt + 1 }));
  if (items.length === 0) return;
  void subscriptionManager.subscribeOnce({ filters: buildVersionFilters(items), relayUrls: PROFILE_RELAYS });
}

/**
 * Library items with no saved-version row yet (tracks saved before tracking
 * existed, or a save that failed offline): record the version we hold so they
 * get update detection too. One batched request; never for our own releases.
 */
async function backfillLibraryVersions(existing: Record<string, SavedAlbumVersion>): Promise<void> {
  const state = store.getState();
  const me = state.identity.pubkey;
  const { savedAlbumIds, savedTrackIds } = state.music.library;
  const items: VersionItem[] = [];
  for (const id of [...savedAlbumIds, ...savedTrackIds]) {
    if (existing[id]) continue;
    const item = state.music.albums[id] ?? state.music.tracks[id];
    if (!item || item.pubkey === me) continue;
    items.push({ addressableId: id, eventId: item.eventId, createdAt: item.createdAt });
  }
  if (items.length > 0) await saveVersions(items);
}

export interface VersionItem {
  addressableId: string;
  eventId: string;
  createdAt: number;
}

/** Record the versions the user has (on save / add to library) — one request
 *  (one NIP-98 signature) for any number of items. */
export async function saveVersions(items: VersionItem[]): Promise<void> {
  if (items.length === 0 || !store.getState().identity.pubkey) return;
  // Optimistic: the saved version is what we hold; the server may keep the
  // flag if it already knows something newer.
  for (const i of items) {
    store.dispatch(setSavedVersion({ addressableId: i.addressableId, savedEventId: i.eventId, savedCreatedAt: i.createdAt, hasUpdate: false }));
  }
  try {
    for (let at = 0; at < items.length; at += 200) {
      const res = await authed(`${getApiBaseUrl()}/music/save-versions`, "POST", { items: items.slice(at, at + 200) });
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: unknown };
      if (!Array.isArray(json.data)) continue;
      for (const raw of json.data) {
        const row = rowFromApi(raw as Record<string, unknown>);
        if (row) store.dispatch(setSavedVersion(row));
      }
    }
  } catch (err) {
    console.debug("[music] Failed to save versions:", err);
  }
}

export function saveVersion(addressableId: string, eventId: string, createdAt: number): Promise<void> {
  return saveVersions([{ addressableId, eventId, createdAt }]);
}

/** The user has seen the update: saved version := newest known, flag off. */
export async function acknowledgeUpdate(addressableId: string): Promise<void> {
  const state = store.getState();
  if (!state.identity.pubkey) return;
  const saved = state.music.savedVersions[addressableId];
  if (!saved) return;
  const target = newestKnownVersion(saved, currentItem(addressableId));

  const previous = saved;
  store.dispatch(setSavedVersion({ addressableId, savedEventId: target.eventId, savedCreatedAt: target.createdAt, hasUpdate: false, latestEventId: null, latestCreatedAt: null }));
  try {
    const res = await authed(`${getApiBaseUrl()}/music/acknowledge-update`, "POST", { addressableId, eventId: target.eventId, createdAt: target.createdAt });
    if (res.status === 404) {
      // Nothing saved server-side (e.g. legacy library) — record what we have.
      await saveVersions([{ addressableId, eventId: target.eventId, createdAt: target.createdAt }]);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const row = rowFromApi(((await res.json()) as { data?: Record<string, unknown> }).data ?? {});
    if (row) store.dispatch(setSavedVersion(row));
  } catch {
    store.dispatch(setSavedVersion(previous));
  }
}

/** Items left the library: stop tracking them (one request). */
export function forgetVersions(addressableIds: string[]): void {
  if (addressableIds.length === 0) return;
  for (const id of addressableIds) store.dispatch(clearSavedVersion(id));
  if (!store.getState().identity.pubkey) return;
  authed(`${getApiBaseUrl()}/music/save-version`, "DELETE", { addressableIds: addressableIds.slice(0, 200) }).catch((err) =>
    console.debug("[music] Failed to forget versions:", err),
  );
}

export function forgetVersion(addressableId: string): void {
  forgetVersions([addressableId]);
}

/** Test hook: reset throttle state. */
export function _resetSavedVersionSyncForTests(): void {
  lastSyncAt = 0;
  lastSyncPubkey = null;
  inFlight = null;
}
