import type { Space } from "../../types/space";
import { saveUserState, getUserState, deleteUserState } from "./userStateStore";
import { APP_RELAY } from "../nostr/constants";

const SPACES_KEY = "spaces";

/** Legacy hostRelay value baked into seed migration 0015 before it was made
 *  env-driven. Existing clients have this cached for every seed space; we
 *  rewrite to the current APP_RELAY on load so they don't keep publishing
 *  group chat to a host that doesn't own the group. */
const LEGACY_LOCAL_HOST = "ws://localhost:7777";

/** Load all spaces from IndexedDB */
export async function loadSpaces(): Promise<Space[]> {
  const data = await getUserState<Space[]>(SPACES_KEY);
  if (!data) return [];

  let mutated = false;
  const normalized = data.map((s) => {
    let next = s;
    // Backfill feedPubkeys for spaces saved before the field existed.
    if (!next.feedPubkeys) {
      next = { ...next, feedPubkeys: [] };
    }
    // Heal stale `ws://localhost:7777` hostRelay cached from old seed data.
    // Only rewrite when this client isn't itself running against localhost.
    if (next.hostRelay === LEGACY_LOCAL_HOST && APP_RELAY !== LEGACY_LOCAL_HOST) {
      next = { ...next, hostRelay: APP_RELAY };
      mutated = true;
    }
    return next;
  });

  if (mutated) {
    await saveSpaces(normalized);
  }
  return normalized;
}

/** Save all spaces to IndexedDB */
export async function saveSpaces(spaces: Space[]): Promise<void> {
  await saveUserState(SPACES_KEY, spaces);
}

/** Add a single space (append + save) */
export async function addSpaceToStore(space: Space): Promise<void> {
  const spaces = await loadSpaces();
  const idx = spaces.findIndex((s) => s.id === space.id);
  if (idx >= 0) {
    spaces[idx] = space;
  } else {
    spaces.push(space);
  }
  await saveSpaces(spaces);
}

/** Remove a space by ID (also cleans up channel cache) */
export async function removeSpaceFromStore(spaceId: string): Promise<void> {
  const spaces = await loadSpaces();
  await saveSpaces(spaces.filter((s) => s.id !== spaceId));
  // Clean up cached channels for this space
  await deleteUserState(`space_channels:${spaceId}`);
}

/** Update an existing space */
export async function updateSpaceInStore(space: Space): Promise<void> {
  const spaces = await loadSpaces();
  const idx = spaces.findIndex((s) => s.id === space.id);
  if (idx >= 0) {
    spaces[idx] = space;
    await saveSpaces(spaces);
  }
}
