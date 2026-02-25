import { saveUserState, getUserState } from "./userStateStore";
import type { SpaceChannel } from "../../types/space";

const KEY_PREFIX = "space_channels:";

/** Save channels for a space to IndexedDB */
export async function saveChannels(spaceId: string, channels: SpaceChannel[]): Promise<void> {
  await saveUserState(`${KEY_PREFIX}${spaceId}`, channels);
}

/** Load channels for a space from IndexedDB */
export async function loadChannels(spaceId: string): Promise<SpaceChannel[] | undefined> {
  return getUserState<SpaceChannel[]>(`${KEY_PREFIX}${spaceId}`);
}
