import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { cachedProfiles } from "../../src/db/schema/profiles.js";
import { PROFILE_JOIN_CAP } from "../../src/services/profileCacheService.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

const SPACE_ID = "members-test-space";

async function seedSpace() {
  await db.insert(spaces).values({
    id: SPACE_ID,
    hostRelay: "wss://relay.test.com",
    name: "Members Test Space",
    createdAt: Math.floor(Date.now() / 1000),
  });
}

/** Deterministic join order: LUNA -> MARCUS -> SAGE */
async function seedMembers() {
  await db.insert(spaceMembers).values([
    { spaceId: SPACE_ID, pubkey: LUNA.pubkey, joinedAt: new Date("2026-01-01T00:00:00Z") },
    { spaceId: SPACE_ID, pubkey: MARCUS.pubkey, joinedAt: new Date("2026-01-02T00:00:00Z") },
    { spaceId: SPACE_ID, pubkey: SAGE.pubkey, joinedAt: new Date("2026-01-03T00:00:00Z") },
  ]);
}

async function seedLunaProfile() {
  await db.insert(cachedProfiles).values({
    pubkey: LUNA.pubkey,
    name: "luna",
    displayName: "Luna Vega",
    picture: "https://example.com/luna.png",
    about: "should not leak into member listings",
    nip05: "luna@thewired.app",
    createdAt: 1_700_000_000,
    fetchedAt: Date.now(),
  });
}

describe("GET /spaces/:id/members", () => {
  beforeEach(async () => {
    await seedSpace();
    await seedMembers();
  });

  it("returns members ordered by joinedAt with legacy fields intact", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.map((m: { pubkey: string }) => m.pubkey)).toEqual([
      LUNA.pubkey,
      MARCUS.pubkey,
      SAGE.pubkey,
    ]);
    // Legacy row shape is unchanged (additive profile only)
    for (const m of body.data) {
      expect(m.spaceId).toBe(SPACE_ID);
      expect(typeof m.pubkey).toBe("string");
      expect(m.joinedAt).toBeTruthy();
      expect(m).toHaveProperty("profile");
    }
  });

  it("inlines the cached profile when cached_profiles has a row", async () => {
    await seedLunaProfile();
    const response = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members`,
    });
    expect(response.statusCode).toBe(200);
    const luna = response.json().data.find((m: { pubkey: string }) => m.pubkey === LUNA.pubkey);
    expect(luna.profile).toEqual({
      name: "luna",
      displayName: "Luna Vega",
      picture: "https://example.com/luna.png",
      nip05: "luna@thewired.app",
      createdAt: 1_700_000_000,
    });
    // Only the picked fields are exposed
    expect(luna.profile).not.toHaveProperty("about");
  });

  it("returns profile null for uncached pubkeys", async () => {
    await seedLunaProfile();
    const response = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members`,
    });
    const body = response.json();
    const marcus = body.data.find((m: { pubkey: string }) => m.pubkey === MARCUS.pubkey);
    const sage = body.data.find((m: { pubkey: string }) => m.pubkey === SAGE.pubkey);
    expect(marcus.profile).toBeNull();
    expect(sage.profile).toBeNull();
  });

  it("applies limit and offset over the joinedAt ordering", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members?limit=1&offset=1`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].pubkey).toBe(MARCUS.pubkey);
  });

  it("rejects invalid limit/offset with 400", async () => {
    const zeroLimit = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members?limit=0`,
    });
    expect(zeroLimit.statusCode).toBe(400);

    const overCap = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members?limit=1001`,
    });
    expect(overCap.statusCode).toBe(400);

    const negativeOffset = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members?offset=-1`,
    });
    expect(negativeOffset.statusCode).toBe(400);
  });

  it("only joins profiles for the first PROFILE_JOIN_CAP rows", async () => {
    // Seed PROFILE_JOIN_CAP + 10 extra members, all with cached profiles, so a
    // null profile past the cap proves the cap (not a cache miss).
    const base = new Date("2026-02-01T00:00:00Z").getTime();
    const extras = Array.from({ length: PROFILE_JOIN_CAP + 10 }, (_, i) => ({
      pubkey: String(i).padStart(64, "0"),
      joinedAt: new Date(base + i * 1000),
    }));
    await db.insert(spaceMembers).values(
      extras.map((e) => ({ spaceId: SPACE_ID, pubkey: e.pubkey, joinedAt: e.joinedAt })),
    );
    await db.insert(cachedProfiles).values(
      extras.map((e, i) => ({
        pubkey: e.pubkey,
        name: `user-${i}`,
        fetchedAt: Date.now(),
      })),
    );

    const response = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/members`,
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json().data;
    // 3 seeded members join before the extras
    expect(rows).toHaveLength(3 + PROFILE_JOIN_CAP + 10);
    // Row inside the cap (an extra with a cached profile) is enriched
    expect(rows[3].profile).toEqual({
      name: "user-0",
      displayName: null,
      picture: null,
      nip05: null,
      createdAt: null,
    });
    expect(rows[PROFILE_JOIN_CAP - 1].profile).not.toBeNull();
    // Rows past the cap get profile null even though a cache row exists
    expect(rows[PROFILE_JOIN_CAP].profile).toBeNull();
    expect(rows[rows.length - 1].profile).toBeNull();
  });
});

describe("GET /spaces/:spaceId/member-roles", () => {
  beforeEach(async () => {
    await seedSpace();
    await seedMembers();
  });

  it("keeps the legacy shape and inlines cached profiles", async () => {
    await seedLunaProfile();
    const response = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/member-roles`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(3);

    const luna = body.data.find((m: { pubkey: string }) => m.pubkey === LUNA.pubkey);
    // Legacy fields unchanged
    expect(Array.isArray(luna.roles)).toBe(true);
    expect(typeof luna.joinedAt).toBe("number");
    // Additive profile
    expect(luna.profile).toEqual({
      name: "luna",
      displayName: "Luna Vega",
      picture: "https://example.com/luna.png",
      nip05: "luna@thewired.app",
      createdAt: 1_700_000_000,
    });
  });

  it("returns profile null for uncached members", async () => {
    const response = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/member-roles`,
    });
    expect(response.statusCode).toBe(200);
    for (const m of response.json().data) {
      expect(m.profile).toBeNull();
    }
  });
});
