import { getDB } from "./database";

/** Keys that are shared across accounts (not prefixed) */
const SHARED_KEYS = new Set(["session"]);

/** Active pubkey for per-account key prefixing */
let activePubkey: string | null = null;

/** Set the active pubkey for IndexedDB key prefixing */
export function setActivePubkey(pubkey: string | null): void {
  activePubkey = pubkey;
}

/** Get the active pubkey */
export function getActivePubkey(): string | null {
  return activePubkey;
}

/** Prefix a key with the active pubkey for per-account isolation */
function accountKey(key: string): string {
  if (SHARED_KEYS.has(key) || !activePubkey) return key;
  return `${activePubkey}:${key}`;
}

/** Save a piece of user state (relay_list, follow_list, etc.) */
export async function saveUserState(
  key: string,
  data: unknown,
): Promise<void> {
  const db = await getDB();
  await db.put("user_state", {
    key: accountKey(key),
    data,
    _cachedAt: Date.now(),
  });
}

/** Load a piece of user state */
export async function getUserState<T = unknown>(
  key: string,
): Promise<T | undefined> {
  const db = await getDB();
  const stored = await db.get("user_state", accountKey(key));
  return stored?.data as T | undefined;
}

/** Delete user state */
export async function deleteUserState(key: string): Promise<void> {
  const db = await getDB();
  await db.delete("user_state", accountKey(key));
}

/** Clear all user state (on full logout) */
export async function clearAllUserState(): Promise<void> {
  const db = await getDB();
  await db.clear("user_state");
}

/** Clear state for a specific account (on single-account removal).
 *  Uses IDBKeyRange to only visit matching keys in the B-tree index. */
export async function clearAccountState(pubkey: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("user_state", "readwrite");
  const store = tx.objectStore("user_state");
  // Range covers all keys from "pubkey:" up to but not including "pubkey;\uffff"
  // (semicolon is the char after colon in ASCII, so this captures all "pubkey:*" keys)
  const range = IDBKeyRange.bound(`${pubkey}:`, `${pubkey}:\uffff`, false, true);
  let cursor = await store.openCursor(range);
  while (cursor) {
    cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Migrate un-prefixed user state keys to per-account prefixed keys.
 * Called once during session restore when transitioning to multi-account.
 */
export async function migrateUnprefixedState(pubkey: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("user_state", "readwrite");
  const store = tx.objectStore("user_state");

  // Keys that should be migrated (user-specific, un-prefixed)
  const migrateKeys = [
    "relay_list", "follow_list", "mute_list", "pinned_notes",
    "dm_relay_list", "last_gift_wrap_ts", "music_library", "music_local_ids",
    "spaces", "last_channels", "dm_state", "dm_read_state",
    "notification_unread_state", "notification_preferences",
    "known_followers", "friend_requests", "gif_favorites", "gif_recents",
    "onboarding",
  ];

  for (const key of migrateKeys) {
    const prefixed = `${pubkey}:${key}`;
    // Only migrate if un-prefixed exists AND prefixed doesn't
    const existing = await store.get(key);
    if (!existing) continue;
    const already = await store.get(prefixed);
    if (already) continue;

    await store.put({ key: prefixed, data: existing.data, _cachedAt: existing._cachedAt });
    await store.delete(key);
  }

  // Also migrate space_channels:* and space_members:* keys
  let cursor = await store.openCursor();
  while (cursor) {
    const k = cursor.key as string;
    const isWildcard =
      (k.startsWith("space_channels:") || k.startsWith("space_members:")) &&
      !k.startsWith(`${pubkey}:`);
    if (isWildcard) {
      const prefixed = `${pubkey}:${k}`;
      const already = await store.get(prefixed);
      if (!already) {
        await store.put({ key: prefixed, data: cursor.value.data, _cachedAt: cursor.value._cachedAt });
      }
      await cursor.delete();
    } else {
      // only advance if we didn't delete (delete advances automatically)
    }
    cursor = await cursor.continue();
  }

  await tx.done;
}
