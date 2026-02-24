import { getDB } from "./database";

/** Save a piece of user state (relay_list, follow_list, etc.) */
export async function saveUserState(
  key: string,
  data: unknown,
): Promise<void> {
  const db = await getDB();
  await db.put("user_state", {
    key,
    data,
    _cachedAt: Date.now(),
  });
}

/** Load a piece of user state */
export async function getUserState<T = unknown>(
  key: string,
): Promise<T | undefined> {
  const db = await getDB();
  const stored = await db.get("user_state", key);
  return stored?.data as T | undefined;
}

/** Delete user state */
export async function deleteUserState(key: string): Promise<void> {
  const db = await getDB();
  await db.delete("user_state", key);
}

/** Clear all user state (on logout) */
export async function clearAllUserState(): Promise<void> {
  const db = await getDB();
  await db.clear("user_state");
}
