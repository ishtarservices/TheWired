import { describe, it, expect } from "vitest";
import { profileCacheService, parseProfileContent } from "../../src/services/profileCacheService.js";
import { LUNA } from "../helpers/testUsers.js";

const content = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "luna",
    display_name: "Luna Vega",
    picture: "https://example.com/a.png",
    about: "hi",
    nip05: "luna@example.com",
    banner: "https://example.com/b.png",
    lud16: "luna@walletofsatoshi.com",
    website: "https://luna.example",
    ...over,
  });

describe("parseProfileContent", () => {
  it("parses all fields", () => {
    const p = parseProfileContent(content());
    expect(p).toMatchObject({
      name: "luna",
      displayName: "Luna Vega",
      banner: "https://example.com/b.png",
      lud16: "luna@walletofsatoshi.com",
      website: "https://luna.example",
    });
  });

  it("returns null on invalid JSON", () => {
    expect(parseProfileContent("not json")).toBeNull();
    expect(parseProfileContent("123")).toBeNull(); // not an object
  });

  it("maps missing/empty fields to null", () => {
    const p = parseProfileContent(JSON.stringify({ name: "x", about: "" }));
    expect(p).toMatchObject({ name: "x", about: null, displayName: null });
    expect(p?.nip05).toBeNull();
  });
});

describe("profileCacheService.upsert (version guard)", () => {
  it("inserts a new profile and stores created_at + all fields", async () => {
    const res = await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 1000, content: content() });
    expect(res?.applied).toBe(true);

    const stored = await profileCacheService.getProfile(LUNA.pubkey);
    expect(stored).toMatchObject({
      pubkey: LUNA.pubkey,
      name: "luna",
      displayName: "Luna Vega",
      banner: "https://example.com/b.png",
      lud16: "luna@walletofsatoshi.com",
      website: "https://luna.example",
      createdAt: 1000,
    });
  });

  it("accepts a newer event (overwrites)", async () => {
    await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 1000, content: content({ name: "old" }) });
    const res = await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 2000, content: content({ name: "new" }) });
    expect(res?.applied).toBe(true);

    const stored = await profileCacheService.getProfile(LUNA.pubkey);
    expect(stored?.name).toBe("new");
    expect(stored?.createdAt).toBe(2000);
  });

  it("REJECTS an older event (no regression)", async () => {
    await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 2000, content: content({ name: "new" }) });
    const res = await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 1000, content: content({ name: "old" }) });
    expect(res?.applied).toBe(false); // guard blocked the older event

    const stored = await profileCacheService.getProfile(LUNA.pubkey);
    expect(stored?.name).toBe("new"); // still the newer version
    expect(stored?.createdAt).toBe(2000);
  });

  it("rejects an equal-timestamp event (idempotent, not a downgrade)", async () => {
    await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 1500, content: content({ name: "first" }) });
    const res = await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 1500, content: content({ name: "second" }) });
    expect(res?.applied).toBe(false);
    const stored = await profileCacheService.getProfile(LUNA.pubkey);
    expect(stored?.name).toBe("first");
  });

  it("returns null on invalid JSON (no write)", async () => {
    const res = await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 1000, content: "garbage" });
    expect(res).toBeNull();
    expect(await profileCacheService.getProfile(LUNA.pubkey)).toBeNull();
  });

  it("getBatchProfiles returns the new versioned fields", async () => {
    await profileCacheService.upsert({ pubkey: LUNA.pubkey, createdAt: 1000, content: content() });
    const rows = await profileCacheService.getBatchProfiles([LUNA.pubkey]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveProperty("createdAt", 1000);
    expect(rows[0]).toHaveProperty("banner", "https://example.com/b.png");
  });
});
