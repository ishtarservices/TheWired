import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { putEvent, getEvent, deleteEvent, getEventsByKind, getEventsByGroup, getEventCount } from "../eventStore";
import { getDB } from "../database";
import type { NostrEvent } from "@/types/nostr";

function makeEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "evt-1",
    pubkey: "pk-1",
    created_at: 1000000,
    kind: 1,
    tags: [],
    content: "hello",
    sig: "sig-1",
    ...overrides,
  };
}

// Reset the DB between tests by clearing all stores
beforeEach(async () => {
  const db = await getDB();
  const tx = db.transaction(["events", "profiles", "user_state", "subscriptions"], "readwrite");
  await tx.objectStore("events").clear();
  await tx.objectStore("profiles").clear();
  await tx.objectStore("user_state").clear();
  await tx.objectStore("subscriptions").clear();
  await tx.done;
});

describe("eventStore", () => {
  it("putEvent stores and getEvent retrieves", async () => {
    const event = makeEvent();
    await putEvent(event);
    const result = await getEvent("evt-1");
    expect(result).toBeDefined();
    expect(result!.id).toBe("evt-1");
    expect(result!.content).toBe("hello");
  });

  it("getEvent returns undefined for missing event", async () => {
    const result = await getEvent("nonexistent");
    expect(result).toBeUndefined();
  });

  it("putEvent strips internal metadata on retrieval", async () => {
    const event = makeEvent({ tags: [["h", "group1"]] });
    await putEvent(event);
    const result = await getEvent("evt-1");
    // Should not have _cachedAt or _groupId
    expect(result).not.toHaveProperty("_cachedAt");
    expect(result).not.toHaveProperty("_groupId");
  });

  it("deleteEvent removes an event", async () => {
    await putEvent(makeEvent());
    await deleteEvent("evt-1");
    const result = await getEvent("evt-1");
    expect(result).toBeUndefined();
  });

  it("getEventsByKind returns events filtered by kind", async () => {
    await putEvent(makeEvent({ id: "e1", kind: 1 }));
    await putEvent(makeEvent({ id: "e2", kind: 1 }));
    await putEvent(makeEvent({ id: "e3", kind: 9 }));
    const results = await getEventsByKind(1);
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.kind === 1)).toBe(true);
  });

  it("getEventsByKind respects limit", async () => {
    for (let i = 0; i < 10; i++) {
      await putEvent(makeEvent({ id: `e-${i}`, kind: 1 }));
    }
    const results = await getEventsByKind(1, 5);
    expect(results).toHaveLength(5);
  });

  it("getEventsByGroup returns events for a group, sorted by created_at", async () => {
    await putEvent(
      makeEvent({ id: "e1", kind: 9, tags: [["h", "g1"]], created_at: 200 }),
    );
    await putEvent(
      makeEvent({ id: "e2", kind: 9, tags: [["h", "g1"]], created_at: 100 }),
    );
    await putEvent(
      makeEvent({ id: "e3", kind: 9, tags: [["h", "g2"]], created_at: 150 }),
    );
    const results = await getEventsByGroup("g1", 9);
    expect(results).toHaveLength(2);
    // Should be sorted ascending
    expect(results[0].created_at).toBe(100);
    expect(results[1].created_at).toBe(200);
  });

  it("getEventCount returns total stored events", async () => {
    await putEvent(makeEvent({ id: "e1" }));
    await putEvent(makeEvent({ id: "e2" }));
    expect(await getEventCount()).toBe(2);
  });

  it("putEvent upserts (same id replaces)", async () => {
    await putEvent(makeEvent({ content: "v1" }));
    await putEvent(makeEvent({ content: "v2" }));
    const result = await getEvent("evt-1");
    expect(result!.content).toBe("v2");
    expect(await getEventCount()).toBe(1);
  });
});
