import type { SpaceMember } from "../../types/space";
import { saveUserState, getUserState, deleteUserState } from "./userStateStore";

/** IDB key prefix — actual key is `space_members:<spaceId>`, then per-account prefixed. */
const PREFIX = "space_members:";

/** Save the full member list (with roles) for a single space. */
export async function saveMembers(
  spaceId: string,
  members: SpaceMember[],
): Promise<void> {
  await saveUserState(`${PREFIX}${spaceId}`, members);
}

/** Load members for a single space. Returns undefined when no entry exists. */
export async function loadMembers(
  spaceId: string,
): Promise<SpaceMember[] | undefined> {
  return getUserState<SpaceMember[]>(`${PREFIX}${spaceId}`);
}

/** Remove the member list for a single space (e.g. on space deletion). */
export async function removeMembers(spaceId: string): Promise<void> {
  await deleteUserState(`${PREFIX}${spaceId}`);
}

/** Load every saved space's member list, keyed by spaceId. Used during login hydration. */
export async function loadAllMembers(): Promise<Map<string, SpaceMember[]>> {
  const { getDB } = await import("./database");
  const { getActivePubkey } = await import("./userStateStore");
  const db = await getDB();
  const tx = db.transaction("user_state", "readonly");
  const store = tx.objectStore("user_state");

  const activePubkey = getActivePubkey();
  const fullPrefix = activePubkey ? `${activePubkey}:${PREFIX}` : PREFIX;
  const result = new Map<string, SpaceMember[]>();

  let cursor = await store.openCursor();
  while (cursor) {
    const key = cursor.key as string;
    if (key.startsWith(fullPrefix)) {
      const spaceId = key.slice(fullPrefix.length);
      result.set(spaceId, cursor.value.data as SpaceMember[]);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return result;
}
