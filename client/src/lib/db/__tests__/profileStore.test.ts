import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { putProfile, getProfile } from "../profileStore";
import { getDB } from "../database";

beforeEach(async () => {
  const db = await getDB();
  await db.clear("profiles");
  vi.useRealTimers();
});

describe("profileStore", () => {
  it("stores and retrieves a profile", async () => {
    await putProfile("pk1", { name: "Luna", about: "test" });
    const result = await getProfile("pk1");
    expect(result).toBeDefined();
    expect(result!.name).toBe("Luna");
    expect(result!.about).toBe("test");
  });

  it("returns undefined for missing profile", async () => {
    const result = await getProfile("nonexistent");
    expect(result).toBeUndefined();
  });

  it("rejects older profile (freshness guard)", async () => {
    await putProfile("pk1", { name: "New", created_at: 200 });
    await putProfile("pk1", { name: "Old", created_at: 100 });
    const result = await getProfile("pk1");
    expect(result!.name).toBe("New");
  });

  it("accepts newer profile over existing", async () => {
    await putProfile("pk1", { name: "Old", created_at: 100 });
    await putProfile("pk1", { name: "New", created_at: 200 });
    const result = await getProfile("pk1");
    expect(result!.name).toBe("New");
  });

  it("accepts profile without created_at (always overwrites)", async () => {
    await putProfile("pk1", { name: "First", created_at: 100 });
    await putProfile("pk1", { name: "Second" }); // no created_at
    const result = await getProfile("pk1");
    expect(result!.name).toBe("Second");
  });

  it("returns undefined for stale profiles (24h TTL)", async () => {
    // Store a profile with a _cachedAt far in the past by writing directly
    const db = await getDB();
    await db.put("profiles", {
      pubkey: "pk1",
      name: "Luna",
      _cachedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
    });

    const result = await getProfile("pk1");
    expect(result).toBeUndefined();
  });

  it("returns profile within TTL window", async () => {
    // Store a profile with recent _cachedAt
    await putProfile("pk1", { name: "Luna" });

    const result = await getProfile("pk1");
    expect(result).toBeDefined();
    expect(result!.name).toBe("Luna");
  });

  it("preserves lud06 and unknown custom fields, and never leaks internal keys", async () => {
    const profile = {
      name: "Luna",
      lud16: "luna@wallet.com",
      lud06: "lnurl1keepme",
      bot: true,
      customField: "keep",
      created_at: 1700000000,
    } as unknown as Parameters<typeof putProfile>[1];

    await putProfile("pk1", profile);
    const result = (await getProfile("pk1")) as Record<string, unknown> | undefined;

    expect(result?.lud16).toBe("luna@wallet.com");
    // Would have been dropped by the old hand-picked getProfile().
    expect(result?.lud06).toBe("lnurl1keepme");
    expect(result?.bot).toBe(true);
    expect(result?.customField).toBe("keep");
    // Internal bookkeeping keys must not surface as profile fields.
    expect(result).not.toHaveProperty("_cachedAt");
    expect(result).not.toHaveProperty("pubkey");
  });
});
