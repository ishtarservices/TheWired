import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import {
  loadSpaces,
  saveSpaces,
  addSpaceToStore,
  removeSpaceFromStore,
  updateSpaceInStore,
} from "../spaceStore";
import { setActivePubkey } from "../userStateStore";
import { getDB } from "../database";
import type { Space } from "@/types/space";

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    name: "Test Space",
    hostRelay: "wss://relay.test.com",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    creatorPubkey: "a".repeat(64),
    createdAt: 1000000,
    ...overrides,
  };
}

beforeEach(async () => {
  const db = await getDB();
  await db.clear("user_state");
  setActivePubkey(null);
});

describe("spaceStore", () => {
  it("returns empty array when no spaces saved", async () => {
    const spaces = await loadSpaces();
    expect(spaces).toEqual([]);
  });

  it("saves and loads spaces", async () => {
    const spaces = [makeSpace(), makeSpace({ id: "space-2", name: "Two" })];
    await saveSpaces(spaces);
    const loaded = await loadSpaces();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].name).toBe("Test Space");
    expect(loaded[1].name).toBe("Two");
  });

  it("backfills feedPubkeys for legacy spaces", async () => {
    // Simulate a space saved without feedPubkeys
    const db = await getDB();
    await db.put("user_state", {
      key: "spaces",
      data: [{ id: "s1", name: "Old", hostRelay: "wss://r", mode: "read-write", memberPubkeys: [] }],
      _cachedAt: Date.now(),
    });
    const loaded = await loadSpaces();
    expect(loaded[0].feedPubkeys).toEqual([]);
  });

  it("addSpaceToStore appends a new space", async () => {
    await addSpaceToStore(makeSpace());
    const loaded = await loadSpaces();
    expect(loaded).toHaveLength(1);
  });

  it("addSpaceToStore upserts by id", async () => {
    await addSpaceToStore(makeSpace({ name: "v1" }));
    await addSpaceToStore(makeSpace({ name: "v2" }));
    const loaded = await loadSpaces();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("v2");
  });

  it("removeSpaceFromStore removes a space", async () => {
    await addSpaceToStore(makeSpace());
    await addSpaceToStore(makeSpace({ id: "space-2" }));
    await removeSpaceFromStore("space-1");
    const loaded = await loadSpaces();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("space-2");
  });

  it("updateSpaceInStore updates an existing space", async () => {
    await addSpaceToStore(makeSpace({ name: "Old" }));
    await updateSpaceInStore(makeSpace({ name: "New" }));
    const loaded = await loadSpaces();
    expect(loaded[0].name).toBe("New");
  });

  it("updateSpaceInStore does nothing if space not found", async () => {
    await addSpaceToStore(makeSpace());
    await updateSpaceInStore(makeSpace({ id: "nonexistent", name: "Ghost" }));
    const loaded = await loadSpaces();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("space-1");
  });
});
