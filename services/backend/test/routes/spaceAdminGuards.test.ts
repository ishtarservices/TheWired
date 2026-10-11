/**
 * WIR-196: PATCH /spaces/:id, the member-role hierarchy mirrored on remove,
 * the creator as the top of the hierarchy, and the space-config-changed
 * nudge each admin write queues.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, and } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, ZARA } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaceMembers, memberRoles } from "../../src/db/schema/members.js";
import { spaceRoles } from "../../src/db/schema/permissions.js";
import { config } from "../../src/config.js";
import {
  flushSpaceSignal,
  resetSpaceSignalForTests,
  setSpaceSignalPublisherForTests,
  type SpaceSignalEvent,
} from "../../src/services/spaceSignalService.js";

let server: FastifyInstance;
const SPACE_ID = "admin-guard-space";

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

let published: SpaceSignalEvent[];
let restorePublisher: () => void;
let savedKey: string;

beforeEach(() => {
  published = [];
  restorePublisher = setSpaceSignalPublisherForTests(async (ev) => {
    published.push(ev);
  });
  savedKey = config.ingestSecretKey;
  config.ingestSecretKey = "7".repeat(64);
  resetSpaceSignalForTests();
});

afterEach(() => {
  restorePublisher();
  config.ingestSecretKey = savedKey;
  resetSpaceSignalForTests();
});

/** LUNA creates the space (creator + Admin). */
async function seedSpace(id = SPACE_ID) {
  const res = await server.inject({
    method: "POST",
    url: "/spaces",
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload: { id, name: "Guarded", hostRelay: "wss://relay.test.com", mode: "read-write" },
  });
  expect(res.statusCode).toBe(200);
}

async function roles(id = SPACE_ID) {
  const res = await server.inject({ method: "GET", url: `/spaces/${id}/roles` });
  return res.json().data as Array<{ id: string; name: string; position: number; isAdmin: boolean; isDefault: boolean }>;
}

/** Add a member straight into the tables (test spaces are unlisted, so the
 *  public join route 403s) with the given role. */
async function addMember(pubkey: string, roleId: string, id = SPACE_ID) {
  await db.insert(spaceMembers).values({ spaceId: id, pubkey }).onConflictDoNothing();
  await db.insert(memberRoles).values({ spaceId: id, pubkey, roleId }).onConflictDoNothing();
}

async function whats(spaceId = SPACE_ID): Promise<string[]> {
  await flushSpaceSignal(spaceId);
  return published.flatMap((ev) => ev.tags.filter((t) => t[0] === "what").map((t) => t[1]));
}

describe("PATCH /spaces/:id", () => {
  it("401s anonymously, 404s an unknown space", async () => {
    await seedSpace();
    const anon = await server.inject({ method: "PATCH", url: `/spaces/${SPACE_ID}`, payload: { name: "x" } });
    expect(anon.statusCode).toBe(401);
    const missing = await server.inject({
      method: "PATCH",
      url: "/spaces/nope",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { name: "x" },
    });
    expect(missing.statusCode).toBe(404);
  });

  it("lets the creator rename, describe and clear the picture, returning the GET shape, and queues a meta nudge", async () => {
    await seedSpace();
    const res = await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE_ID}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { name: "Renamed", about: "  late nights  ", picture: null },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.id).toBe(SPACE_ID);
    expect(body.name).toBe("Renamed");
    expect(body.about).toBe("late nights");
    expect(body.picture).toBeNull();
    expect(Array.isArray(body.tags)).toBe(true);

    const get = await server.inject({ method: "GET", url: `/spaces/${SPACE_ID}` });
    expect(get.json().data.name).toBe("Renamed");
    expect(await whats()).toEqual(["meta"]);
  });

  it("refuses a plain member (no MANAGE_SPACE) and an empty patch", async () => {
    await seedSpace();
    const member = (await roles()).find((r) => r.isDefault)!;
    await addMember(MARCUS.pubkey, member.id);
    const forbidden = await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE_ID}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { name: "hijack" },
    });
    expect(forbidden.statusCode).toBe(403);
    const empty = await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE_ID}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    expect(await whats()).toEqual([]);
  });

  it("lets a non-creator Admin edit too (admin bypass), unchanged fields stay", async () => {
    await seedSpace();
    const admin = (await roles()).find((r) => r.isAdmin)!;
    await addMember(MARCUS.pubkey, admin.id);
    const res = await server.inject({
      method: "PATCH",
      url: `/spaces/${SPACE_ID}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { about: "by an admin" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe("Guarded");
    expect(res.json().data.about).toBe("by an admin");
  });
});

describe("member-role hierarchy", () => {
  it("an Admin assigns and removes roles below Admin, never Admin itself; the creator can", async () => {
    await seedSpace();
    const all = await roles();
    const admin = all.find((r) => r.isAdmin)!;
    const member = all.find((r) => r.isDefault)!;
    await addMember(MARCUS.pubkey, admin.id);
    await addMember(ZARA.pubkey, member.id);

    // Admin → Member role on ZARA: fine (position 1 > 0).
    const assignOk = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { roleId: member.id },
    });
    expect(assignOk.statusCode).toBe(200);

    // Admin → Admin role on ZARA: refused (equal rank).
    const assignAdmin = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { roleId: admin.id },
    });
    expect(assignAdmin.statusCode).toBe(403);

    // Creator → Admin role on ZARA: allowed.
    const creatorAssign = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { roleId: admin.id },
    });
    expect(creatorAssign.statusCode).toBe(200);

    // Admin MARCUS cannot strip Admin from ZARA (equal rank)…
    const peerDemote = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles/${admin.id}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(peerDemote.statusCode).toBe(403);
    // …nor touch the creator's roles at all.
    const demoteOwner = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}/members/${LUNA.pubkey}/roles/${admin.id}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(demoteOwner.statusCode).toBe(403);
    // …but can remove the Member role from ZARA.
    const stripMember = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles/${member.id}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(stripMember.statusCode).toBe(200);
    // The creator demotes ZARA from Admin.
    const creatorDemote = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles/${admin.id}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(creatorDemote.statusCode).toBe(200);

    const left = await db
      .select()
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, SPACE_ID), eq(memberRoles.pubkey, ZARA.pubkey)));
    expect(left).toHaveLength(0);
    expect(await whats()).toEqual(["members"]);
  });

  it("404s a role id from another space on assign and remove (no cross-space admin grant)", async () => {
    await seedSpace();
    await seedSpace("other-space");
    const foreignAdmin = (await roles("other-space")).find((r) => r.isAdmin)!;
    const member = (await roles()).find((r) => r.isDefault)!;
    await addMember(ZARA.pubkey, member.id);
    const assign = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { roleId: foreignAdmin.id },
    });
    expect(assign.statusCode).toBe(404);
    const remove = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}/members/${ZARA.pubkey}/roles/${foreignAdmin.id}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(remove.statusCode).toBe(404);
    const rows = await db.select().from(spaceRoles).where(eq(spaceRoles.id, foreignAdmin.id));
    expect(rows).toHaveLength(1);
  });
});

describe("moderation hierarchy with the creator at the top", () => {
  it("nobody kicks the creator; the creator kicks an admin; an admin can't kick a peer admin", async () => {
    await seedSpace();
    const admin = (await roles()).find((r) => r.isAdmin)!;
    await addMember(MARCUS.pubkey, admin.id);
    await addMember(ZARA.pubkey, admin.id);

    const kickOwner = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/moderation/kick/${LUNA.pubkey}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(kickOwner.statusCode).toBe(403);
    expect(kickOwner.json().error).toMatch(/creator/i);

    const peer = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/moderation/kick/${ZARA.pubkey}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(peer.statusCode).toBe(403);

    const creatorKick = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/moderation/kick/${ZARA.pubkey}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(creatorKick.statusCode).toBe(200);
    const left = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, SPACE_ID), eq(spaceMembers.pubkey, ZARA.pubkey)));
    expect(left).toHaveLength(0);
    expect(await whats()).toEqual(["members"]);
  });

  it("channel and role writes queue their own nudges", async () => {
    await seedSpace();
    const created = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/channels`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { type: "chat", label: "#ops" },
    });
    expect(created.statusCode).toBe(200);
    const del = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}/channels/${created.json().data.id}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(del.statusCode).toBe(200);
    const role = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/roles`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { name: "crew", permissions: ["SEND_MESSAGES"] },
    });
    expect(role.statusCode).toBe(200);
    // One coalesced event: channels + roles.
    expect(await whats()).toEqual(["channels", "roles"]);
    expect(published).toHaveLength(1);
  });
});
