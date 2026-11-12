import { saveUserState, getUserState } from "./userStateStore";
import type { SpaceChannel, SpaceChannelCategory } from "../../types/space";

const KEY_PREFIX = "space_channels:";

/** Save channels for a space to IndexedDB */
export async function saveChannels(spaceId: string, channels: SpaceChannel[]): Promise<void> {
  await saveUserState(`${KEY_PREFIX}${spaceId}`, channels);
}

/** Load channels for a space from IndexedDB */
export async function loadChannels(spaceId: string): Promise<SpaceChannel[] | undefined> {
  return getUserState<SpaceChannel[]>(`${KEY_PREFIX}${spaceId}`);
}

const CATEGORY_PREFIX = "space_categories:";

export interface CachedCategories {
  categories: SpaceChannelCategory[];
  revision?: number;
}

/** Save a space's subfolders (+ layout revision) to IndexedDB */
export async function saveCategories(spaceId: string, value: CachedCategories): Promise<void> {
  await saveUserState(`${CATEGORY_PREFIX}${spaceId}`, value);
}

/** Load a space's cached subfolders, or undefined when never cached */
export async function loadCategories(spaceId: string): Promise<CachedCategories | undefined> {
  return getUserState<CachedCategories>(`${CATEGORY_PREFIX}${spaceId}`);
}
