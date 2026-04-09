import { saveUserState, getUserState } from "./userStateStore";

const STORE_KEY = "last_channels";

/** In-memory mirror — reads are synchronous after init */
let cache: Record<string, string> = {};

/** Load from IndexedDB (call once at startup) */
export async function initLastChannelCache(): Promise<void> {
  const stored = await getUserState<Record<string, string>>(STORE_KEY);
  if (stored) cache = stored;
}

/** Get the last channel ID for a space (sync read from memory) */
export function getLastChannel(spaceId: string): string | undefined {
  return cache[spaceId];
}

/** Save the last channel for a space (writes through to IndexedDB) */
export function setLastChannel(spaceId: string, channelId: string): void {
  cache[spaceId] = channelId;
  saveUserState(STORE_KEY, cache);
}

/** Remove cached channel for a space (e.g. on space deletion) */
export function removeLastChannel(spaceId: string): void {
  delete cache[spaceId];
  saveUserState(STORE_KEY, cache);
}

/** Clear in-memory cache (on logout) */
export function clearLastChannelCache(): void {
  cache = {};
}
