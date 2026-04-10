import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  saveUserState,
  getUserState,
  deleteUserState,
  clearAllUserState,
  clearAccountState,
  setActivePubkey,
} from "../userStateStore";
import { getDB } from "../database";

beforeEach(async () => {
  const db = await getDB();
  await db.clear("user_state");
  setActivePubkey(null);
});

describe("userStateStore", () => {
  it("saves and loads user state", async () => {
    await saveUserState("test_key", { value: 42 });
    const result = await getUserState<{ value: number }>("test_key");
    expect(result).toEqual({ value: 42 });
  });

  it("returns undefined for missing keys", async () => {
    const result = await getUserState("nonexistent");
    expect(result).toBeUndefined();
  });

  it("deletes user state", async () => {
    await saveUserState("test_key", "hello");
    await deleteUserState("test_key");
    const result = await getUserState("test_key");
    expect(result).toBeUndefined();
  });

  it("clears all user state", async () => {
    await saveUserState("key1", "val1");
    await saveUserState("key2", "val2");
    await clearAllUserState();
    expect(await getUserState("key1")).toBeUndefined();
    expect(await getUserState("key2")).toBeUndefined();
  });

  // ─── Per-account key prefixing ─────────────────

  it("prefixes keys with active pubkey", async () => {
    setActivePubkey("pk123");
    await saveUserState("spaces", ["space1"]);
    // Direct DB check: key should be prefixed
    const db = await getDB();
    const stored = await db.get("user_state", "pk123:spaces");
    expect(stored).toBeDefined();
    expect(stored!.data).toEqual(["space1"]);
  });

  it("loads prefixed state when pubkey is set", async () => {
    setActivePubkey("pk123");
    await saveUserState("spaces", ["space1"]);
    const result = await getUserState("spaces");
    expect(result).toEqual(["space1"]);
  });

  it("isolates state between accounts", async () => {
    setActivePubkey("pk-alice");
    await saveUserState("spaces", ["alice-space"]);

    setActivePubkey("pk-bob");
    await saveUserState("spaces", ["bob-space"]);

    setActivePubkey("pk-alice");
    expect(await getUserState("spaces")).toEqual(["alice-space"]);

    setActivePubkey("pk-bob");
    expect(await getUserState("spaces")).toEqual(["bob-space"]);
  });

  it("shared keys are not prefixed", async () => {
    setActivePubkey("pk123");
    await saveUserState("session", { token: "abc" });
    // Should be stored without prefix
    const db = await getDB();
    const stored = await db.get("user_state", "session");
    expect(stored).toBeDefined();
    expect(stored!.data).toEqual({ token: "abc" });
  });

  it("clearAccountState only removes that account's keys", async () => {
    setActivePubkey("pk-alice");
    await saveUserState("spaces", ["alice"]);
    await saveUserState("dm_state", { msgs: [] });

    setActivePubkey("pk-bob");
    await saveUserState("spaces", ["bob"]);

    await clearAccountState("pk-alice");

    // Alice's data should be gone
    setActivePubkey("pk-alice");
    expect(await getUserState("spaces")).toBeUndefined();

    // Bob's data should remain
    setActivePubkey("pk-bob");
    expect(await getUserState("spaces")).toEqual(["bob"]);
  });
});
