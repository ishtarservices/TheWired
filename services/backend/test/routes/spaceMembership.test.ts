/**
 * Space membership integrity: every path that adds or removes a member keeps
 * `app.spaces.member_count` equal to the rows in `app.space_members`, invite
 * use limits hold under concurrent redeems, and a space can never be left
 * without an admin.
 *
 * The postgres-js pool holds several connections, so `Promise.all` of
 * `server.inject` calls below really runs concurrently against Postgres.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, SAGE, ZARA, DECKARD, JAYDEE } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers, memberRoles } from "../../src/db/schema/members.js";
import { spaceRoles } from "../../src/db/schema/permissions.js";
import { invites } from "../../src/db/schema/invites.js";
import { moderationService } from "../../src/services/moderationService.js";
import { processEvent, type IngestContext } from "../../src/workers/ingestHandlers.js";
import { finalizeEvent } from "nostr-tools";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

const SPACE = "membership-space";
const as = (pubkey: string) => ({ "x-auth-pubkey": pubkey });

/** LUNA creates the space through the API (creator + Admin, count 1). */
async function seedSpace(opts: { id?: string; listed?: boolean } = {}) {
  const id = opts.id ?? SPACE;
  const res = await server.inject({
    method: "POST",
    url: "/spaces",
    headers: as(LUNA.pubkey),
    payload: { id, name: "Membership", hostRelay: "wss://relay.test.com", mode: "read-write" },
  });
  expect(res.statusCode).toBe(200);
  if (opts.listed) await db.update(spaces).set({ listed: true }).where(eq(spaces.id, id));
  return id;
}

async function roleId(kind: "admin" | "default", spaceId = SPACE): Promise<string> {
  const rows = await db.select().from(spaceRoles).where(eq(spaceRoles.spaceId, spaceId));
  const role = rows.find((r) => (kind === "admin" ? r.isAdmin : r.isDefault));
  if (!role) throw new Error(`no ${kind} role in ${spaceId}`);
  return role.id;
}

/** Put a member straight into the tables (bypasses every route). */
async function addMember(pubkey: string, role: "admin" | "default" | null = "default", spaceId = SPACE) {
  await db.insert(spaceMembers).values({ spaceId, pubkey }).onConflictDoNothing();
  if (role) {
    await db.insert(memberRoles).values({ spaceId, pubkey, roleId: await roleId(role, spaceId) }).onConflictDoNothing();
  }
}

async function makeInvite(
  code: string,
  opts: { maxUses?: number | null; expiresAt?: number | null; revoked?: boolean; spaceId?: string } = {},
) {
  await db.insert(invites).values({
    code,
    spaceId: opts.spaceId ?? SPACE,
    createdBy: LUNA.pubkey,
    maxUses: opts.maxUses ?? null,
    expiresAt: opts.expiresAt ?? null,
    revoked: opts.revoked ?? false,
  });
}

const redeem = (code: string, pubkey: string) =>
  server.inject({ method: "POST", url: `/invites/${code}/redeem`, headers: as(pubkey) });
const join = (pubkey: string, spaceId = SPACE) =>
  server.inject({ method: "POST", url: `/spaces/${spaceId}/members/me`, headers: as(pubkey) });
const leave = (pubkey: string, spaceId = SPACE) =>
  server.inject({ method: "DELETE", url: `/spaces/${spaceId}/members/me`, headers: as(pubkey) });

async function storedCount(spaceId = SPACE): Promise<number> {
  const [row] = await db.select({ n: spaces.memberCount }).from(spaces).where(eq(spaces.id, spaceId));
  return row.n;
}

async function rowCount(spaceId = SPACE): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId));
  return row.n;
}

async function isMember(pubkey: string, spaceId = SPACE): Promise<boolean> {
  const rows = await db
    .select()
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.pubkey, pubkey)));
  return rows.length > 0;
}

async function useCount(code: string): Promise<number> {
  const [row] = await db.select({ n: invites.useCount }).from(invites).where(eq(invites.code, code));
  return row.n;
}

async function creatorOf(spaceId = SPACE): Promise<string | null> {
  const [row] = await db.select({ c: spaces.creatorPubkey }).from(spaces).where(eq(spaces.id, spaceId));
  return row.c;
}

/** The invariant every test ends on. */
async function expectCountMatchesRows(spaceId = SPACE) {
  expect(await storedCount(spaceId)).toBe(await rowCount(spaceId));
}

const statuses = (responses: Array<{ statusCode: number }>) => responses.map((r) => r.statusCode).sort();

// ── Redeem ────────────────────────────────────────────────────────────────

describe("POST /invites/:code/redeem", () => {
  it("raises member_count and returns the new count", async () => {
    await seedSpace();
    await makeInvite("one-shot", { maxUses: 1 });
    const res = await redeem("one-shot", MARCUS.pubkey);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.space.memberCount).toBe(2);
    expect(await storedCount()).toBe(2);
    await expectCountMatchesRows();
  });

  it("returns the space's creator and host relay to the redeemer", async () => {
    await seedSpace();
    await makeInvite("details");
    const res = await redeem("details", MARCUS.pubkey);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.space.creatorPubkey).toBe(LUNA.pubkey);
    expect(res.json().data.space.hostRelay).toBe("wss://relay.test.com");
  });

  it("lets exactly one of five concurrent redeemers use a 1-use invite", async () => {
    await seedSpace();
    await makeInvite("race-1", { maxUses: 1 });
    const racers = [MARCUS, SAGE, ZARA, DECKARD, JAYDEE];
    const res = await Promise.all(racers.map((u) => redeem("race-1", u.pubkey)));
    expect(statuses(res)).toEqual([200, 410, 410, 410, 410]);
    for (const r of res.filter((x) => x.statusCode === 410)) expect(r.json().code).toBe("INVITE_EXHAUSTED");
    expect(await useCount("race-1")).toBe(1);
    expect(await rowCount()).toBe(2);
    await expectCountMatchesRows();
  });

  it("caps a 2-use invite at two concurrent redeemers", async () => {
    await seedSpace();
    await makeInvite("race-2", { maxUses: 2 });
    const res = await Promise.all([MARCUS, SAGE, ZARA, DECKARD, JAYDEE].map((u) => redeem("race-2", u.pubkey)));
    expect(statuses(res)).toEqual([200, 200, 410, 410, 410]);
    expect(await useCount("race-2")).toBe(2);
    expect(await rowCount()).toBe(3);
    await expectCountMatchesRows();
  });

  it("answers the same user's concurrent redeems with 200 + 409 and burns one use", async () => {
    await seedSpace();
    await makeInvite("double");
    const res = await Promise.all([redeem("double", MARCUS.pubkey), redeem("double", MARCUS.pubkey)]);
    expect(statuses(res)).toEqual([200, 409]);
    expect(res.find((r) => r.statusCode === 409)!.json().code).toBe("ALREADY_MEMBER");
    expect(await useCount("double")).toBe(1);
    await expectCountMatchesRows();
  });

  it.each([
    ["no limit", null],
    ["max_uses 0", 0],
  ])("treats an invite with %s as unlimited", async (_label, maxUses) => {
    await seedSpace();
    await makeInvite("open", { maxUses });
    const res = await Promise.all([MARCUS, SAGE, ZARA, DECKARD, JAYDEE].map((u) => redeem("open", u.pubkey)));
    expect(statuses(res)).toEqual([200, 200, 200, 200, 200]);
    expect(await useCount("open")).toBe(5);
    expect(await storedCount()).toBe(6);
    await expectCountMatchesRows();
  });

  it("burns no use and adds no row when the redeem is refused", async () => {
    await seedSpace();
    await makeInvite("expired", { maxUses: 5, expiresAt: Date.now() - 1000 });
    await makeInvite("revoked", { maxUses: 5, revoked: true });
    await makeInvite("good", { maxUses: 5 });
    await moderationService.banMember(SPACE, { pubkey: ZARA.pubkey, bannedBy: LUNA.pubkey });

    expect((await redeem("expired", MARCUS.pubkey)).statusCode).toBe(410);
    expect((await redeem("revoked", MARCUS.pubkey)).statusCode).toBe(404);
    expect((await redeem("missing", MARCUS.pubkey)).statusCode).toBe(404);
    const banned = await redeem("good", ZARA.pubkey);
    expect(banned.statusCode).toBe(403);
    expect(banned.json().code).toBe("BANNED");
    const existing = await redeem("good", LUNA.pubkey);
    expect(existing.statusCode).toBe(409);
    const anon = await server.inject({ method: "POST", url: "/invites/good/redeem" });
    expect(anon.statusCode).toBe(401);

    expect(await useCount("expired")).toBe(0);
    expect(await useCount("revoked")).toBe(0);
    expect(await useCount("good")).toBe(0);
    expect(await rowCount()).toBe(1);
    await expectCountMatchesRows();
  });

  it("keeps the count right across redeem → leave → redeem", async () => {
    await seedSpace();
    await makeInvite("again");
    expect((await redeem("again", MARCUS.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(2);
    expect((await leave(MARCUS.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(1);
    expect((await redeem("again", MARCUS.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(2);
    expect(await useCount("again")).toBe(2);
    await expectCountMatchesRows();
  });

  it("restores a kicked member's roles on redeem without duplicating them", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "default");
    const kick = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE}/moderation/kick/${MARCUS.pubkey}`,
      headers: as(LUNA.pubkey),
    });
    expect(kick.statusCode).toBe(200);
    await makeInvite("back");
    expect((await redeem("back", MARCUS.pubkey)).statusCode).toBe(200);
    const roles = await db
      .select()
      .from(memberRoles)
      .where(and(eq(memberRoles.spaceId, SPACE), eq(memberRoles.pubkey, MARCUS.pubkey)));
    expect(roles.map((r) => r.roleId)).toEqual([await roleId("default")]);
    await expectCountMatchesRows();
  });
});

// ── Join a listed space ───────────────────────────────────────────────────

describe("POST /spaces/:id/members/me", () => {
  it("handles the same user's concurrent joins without a 500", async () => {
    await seedSpace({ listed: true });
    const res = await Promise.all([join(MARCUS.pubkey), join(MARCUS.pubkey)]);
    expect(statuses(res)).toEqual([200, 200]);
    expect(await storedCount()).toBe(2);
    await expectCountMatchesRows();
  });

  it("refuses unlisted spaces and banned users, and leaves an existing member as is", async () => {
    await seedSpace();
    expect((await join(MARCUS.pubkey)).statusCode).toBe(403);
    await db.update(spaces).set({ listed: true }).where(eq(spaces.id, SPACE));
    await moderationService.banMember(SPACE, { pubkey: ZARA.pubkey, bannedBy: LUNA.pubkey });
    const banned = await join(ZARA.pubkey);
    expect(banned.statusCode).toBe(403);
    expect(banned.json().code).toBe("BANNED");
    expect((await join(LUNA.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(1);
    await expectCountMatchesRows();
  });
});

// ── Leave ─────────────────────────────────────────────────────────────────

describe("DELETE /spaces/:id/members/me", () => {
  it("removes an ordinary member and their roles; a repeat leave is a no-op", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "default");
    await db.update(spaces).set({ memberCount: 2 }).where(eq(spaces.id, SPACE));
    expect((await leave(MARCUS.pubkey)).statusCode).toBe(200);
    expect(await isMember(MARCUS.pubkey)).toBe(false);
    const roles = await db.select().from(memberRoles).where(eq(memberRoles.pubkey, MARCUS.pubkey));
    expect(roles).toHaveLength(0);
    expect(await storedCount()).toBe(1);
    expect((await leave(MARCUS.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(1);
  });

  it("refuses the sole admin (the creator) with LAST_ADMIN", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "default");
    const res = await leave(LUNA.pubkey);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LAST_ADMIN");
    expect(await isMember(LUNA.pubkey)).toBe(true);
    expect(await creatorOf()).toBe(LUNA.pubkey);
  });

  it("refuses the creator who is the only member", async () => {
    await seedSpace();
    const res = await leave(LUNA.pubkey);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LAST_ADMIN");
    expect(await rowCount()).toBe(1);
  });

  it("treats a creator without an explicit admin role as an admin", async () => {
    await seedSpace();
    await db.delete(memberRoles).where(and(eq(memberRoles.spaceId, SPACE), eq(memberRoles.pubkey, LUNA.pubkey)));
    await addMember(MARCUS.pubkey, "default");
    const res = await leave(LUNA.pubkey);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LAST_ADMIN");
  });

  it("lets a non-creator admin leave while the creator stays an admin", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "admin");
    const res = await leave(MARCUS.pubkey);
    expect(res.statusCode).toBe(200);
    expect(await isMember(MARCUS.pubkey)).toBe(false);
    expect(await creatorOf()).toBe(LUNA.pubkey);
    await expectCountMatchesRows();
  });

  it("hands ownership to the remaining admins when the creator leaves", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "admin");
    const res = await leave(LUNA.pubkey);
    expect(res.statusCode).toBe(200);
    expect(await creatorOf()).toBeNull();
    await expectCountMatchesRows();

    // The ex-creator holds no powers and is not silently re-added.
    const invite = await server.inject({
      method: "POST",
      url: "/invites",
      headers: as(LUNA.pubkey),
      payload: { spaceId: SPACE },
    });
    expect(invite.statusCode).toBe(403);
    const check = await server.inject({
      method: "GET",
      url: `/permissions/check?spaceId=${SPACE}&permission=CREATE_INVITES&pubkey=${LUNA.pubkey}`,
      headers: as(MARCUS.pubkey),
    });
    expect(check.json().data.allowed).toBe(false);
    expect(await isMember(LUNA.pubkey)).toBe(false);
    const exDelete = await server.inject({ method: "DELETE", url: `/spaces/${SPACE}`, headers: as(LUNA.pubkey) });
    expect(exDelete.statusCode).toBe(403);
    await expectCountMatchesRows();

    // The remaining admin now owns the space.
    const del = await server.inject({ method: "DELETE", url: `/spaces/${SPACE}`, headers: as(MARCUS.pubkey) });
    expect(del.statusCode).toBe(200);
  });

  it("refuses the last admin once the creator has gone", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "admin");
    await addMember(SAGE.pubkey, "default");
    expect((await leave(LUNA.pubkey)).statusCode).toBe(200);
    const res = await leave(MARCUS.pubkey);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LAST_ADMIN");
    expect(await isMember(MARCUS.pubkey)).toBe(true);
  });

  it("never lets the only two admins both leave at once", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "admin");
    await addMember(SAGE.pubkey, "default");
    const res = await Promise.all([leave(LUNA.pubkey), leave(MARCUS.pubkey)]);
    expect(statuses(res)).toEqual([200, 409]);
    const admins = await db
      .select({ pubkey: memberRoles.pubkey })
      .from(memberRoles)
      .innerJoin(spaceRoles, eq(spaceRoles.id, memberRoles.roleId))
      .innerJoin(
        spaceMembers,
        and(eq(spaceMembers.spaceId, memberRoles.spaceId), eq(spaceMembers.pubkey, memberRoles.pubkey)),
      )
      .where(and(eq(memberRoles.spaceId, SPACE), eq(spaceRoles.isAdmin, true)));
    expect(admins).toHaveLength(1);
    await expectCountMatchesRows();
  });
});

// ── Kick and ban ──────────────────────────────────────────────────────────

describe("kick and ban", () => {
  it("lower the count for members and leave it alone for a pre-emptive ban", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "default");
    await addMember(SAGE.pubkey, "default");
    await db.update(spaces).set({ memberCount: 3 }).where(eq(spaces.id, SPACE));

    const kick = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE}/moderation/kick/${MARCUS.pubkey}`,
      headers: as(LUNA.pubkey),
    });
    expect(kick.statusCode).toBe(200);
    expect(await storedCount()).toBe(2);

    const ban = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE}/moderation/bans`,
      headers: as(LUNA.pubkey),
      payload: { pubkey: SAGE.pubkey },
    });
    expect(ban.statusCode).toBe(200);
    expect(await storedCount()).toBe(1);

    const preemptive = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE}/moderation/bans`,
      headers: as(LUNA.pubkey),
      payload: { pubkey: JAYDEE.pubkey },
    });
    expect(preemptive.statusCode).toBe(200);
    expect(await storedCount()).toBe(1);
    await expectCountMatchesRows();
  });
});

// ── Drift heals on the next change ────────────────────────────────────────

describe("member_count self-heals", () => {
  async function seedDrift() {
    await seedSpace();
    await addMember(MARCUS.pubkey, "default");
    await addMember(SAGE.pubkey, "default");
    await db.update(spaces).set({ memberCount: 0 }).where(eq(spaces.id, SPACE));
  }

  it("on redeem", async () => {
    await seedDrift();
    await makeInvite("heal");
    expect((await redeem("heal", ZARA.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(4);
  });

  it("on leave", async () => {
    await seedDrift();
    expect((await leave(SAGE.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(2);
  });

  it("on join", async () => {
    await seedDrift();
    await db.update(spaces).set({ listed: true }).where(eq(spaces.id, SPACE));
    expect((await join(ZARA.pubkey)).statusCode).toBe(200);
    expect(await storedCount()).toBe(4);
  });

  it("on kick", async () => {
    await seedDrift();
    await server.inject({
      method: "POST",
      url: `/spaces/${SPACE}/moderation/kick/${SAGE.pubkey}`,
      headers: as(LUNA.pubkey),
    });
    expect(await storedCount()).toBe(2);
  });
});

// ── Validation ────────────────────────────────────────────────────────────

describe("space name validation", () => {
  const create = (payload: Record<string, unknown>) =>
    server.inject({ method: "POST", url: "/spaces", headers: as(LUNA.pubkey), payload });
  const base = { hostRelay: "wss://relay.test.com" };

  it.each([
    ["spaces", "   "],
    ["tabs and newlines", "\t\n "],
  ])("rejects a name made only of %s on create", async (_label, name) => {
    const res = await create({ ...base, id: "blank-name", name });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a blank id and a blank channel label", async () => {
    expect((await create({ ...base, id: "   ", name: "ok" })).statusCode).toBe(400);
    const res = await create({ ...base, id: "blank-label", name: "ok", channels: [{ type: "chat", label: "  " }] });
    expect(res.statusCode).toBe(400);
  });

  it("trims the name and allows 100 characters but not 101", async () => {
    const padded = await create({ ...base, id: "padded", name: "  Padded  " });
    expect(padded.statusCode).toBe(200);
    const [row] = await db.select({ name: spaces.name }).from(spaces).where(eq(spaces.id, "padded"));
    expect(row.name).toBe("Padded");
    expect((await create({ ...base, id: "len-100", name: "x".repeat(100) })).statusCode).toBe(200);
    expect((await create({ ...base, id: "len-101", name: "x".repeat(101) })).statusCode).toBe(400);
  });

  it("rejects a blank name on PATCH and accepts any name create accepts", async () => {
    await seedSpace();
    const patch = (name: string) =>
      server.inject({ method: "PATCH", url: `/spaces/${SPACE}`, headers: as(LUNA.pubkey), payload: { name } });
    expect((await patch("   ")).statusCode).toBe(400);
    expect((await patch("y".repeat(80))).statusCode).toBe(200);
    expect((await patch("y".repeat(100))).statusCode).toBe(200);
    expect((await patch("y".repeat(101))).statusCode).toBe(400);
  });
});

// ── Backfill migration ────────────────────────────────────────────────────

describe("migration 0038 member_count backfill", () => {
  const migration = fileURLToPath(
    new URL("../../src/db/migrations/0038_member_count_backfill.sql", import.meta.url),
  );

  it("corrects drift both ways, zeroes empty spaces, skips relay-native spaces, and is idempotent", async () => {
    await seedSpace({ id: "drift-low" });
    await addMember(MARCUS.pubkey, "default", "drift-low");
    await addMember(SAGE.pubkey, "default", "drift-low");
    await db.update(spaces).set({ memberCount: 0 }).where(eq(spaces.id, "drift-low"));

    await seedSpace({ id: "drift-high" });
    await db.update(spaces).set({ memberCount: 9 }).where(eq(spaces.id, "drift-high"));

    await seedSpace({ id: "emptied" });
    await db.delete(spaceMembers).where(eq(spaceMembers.spaceId, "emptied"));

    await seedSpace({ id: "native" });
    await db.update(spaces).set({ spaceMode: "nip29", memberCount: 7 }).where(eq(spaces.id, "native"));

    const sqlText = readFileSync(migration, "utf8");
    await db.execute(sql.raw(sqlText));
    expect(await storedCount("drift-low")).toBe(3);
    expect(await storedCount("drift-high")).toBe(1);
    expect(await storedCount("emptied")).toBe(0);
    expect(await storedCount("native")).toBe(7);

    await db.execute(sql.raw(sqlText));
    expect(await storedCount("drift-low")).toBe(3);
    expect(await storedCount("native")).toBe(7);
  });
});

// ── Relay join/leave requests (kinds 9021/9022) on the ingest path ────────

describe("ingest of kinds 9021/9022 for backend-owned spaces", () => {
  const own: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
  const signed = (kind: number, user: { secretKey: Uint8Array }, spaceId = SPACE) =>
    finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags: [["h", spaceId]], content: "" }, user.secretKey);

  it("never grants membership from a join request", async () => {
    await seedSpace({ listed: true });
    await processEvent(signed(9021, MARCUS), own);
    expect(await isMember(MARCUS.pubkey)).toBe(false);
    await expectCountMatchesRows();
  });

  it("applies a leave request with the REST rules and recounts", async () => {
    await seedSpace();
    await addMember(MARCUS.pubkey, "default");
    await processEvent(signed(9022, MARCUS), own);
    expect(await isMember(MARCUS.pubkey)).toBe(false);
    await expectCountMatchesRows();

    await processEvent(signed(9022, LUNA), own);
    expect(await isMember(LUNA.pubkey)).toBe(true);
    expect(await creatorOf()).toBe(LUNA.pubkey);
  });

  it("never touches a relay-native space's counter", async () => {
    await seedSpace({ id: "native-space" });
    await db.update(spaces).set({ spaceMode: "nip29", memberCount: 4 }).where(eq(spaces.id, "native-space"));
    await processEvent(signed(9021, MARCUS, "native-space"), own);
    await processEvent(signed(9022, LUNA, "native-space"), own);
    expect(await storedCount("native-space")).toBe(4);
  });
});
