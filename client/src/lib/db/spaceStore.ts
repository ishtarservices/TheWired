import type { Space } from "../../types/space";
import { saveUserState, getUserState, deleteUserState } from "./userStateStore";

const SPACES_KEY = "spaces";

/** Load all spaces from IndexedDB */
export async function loadSpaces(): Promise<Space[]> {
  const data = await getUserState<Space[]>(SPACES_KEY);
  if (!data) return [];
  // Backfill feedPubkeys for spaces saved before the field existed
  return data.map((s) => (s.feedPubkeys ? s : { ...s, feedPubkeys: [] }));
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
