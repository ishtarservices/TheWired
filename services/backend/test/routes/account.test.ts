/**
 * DELETE /account (App Store 5.1.1(v), NIP-62).
 *
 *  - validation matrix: schema, INVALID_EVENT, FORBIDDEN, INVALID_VANISH_TARGET,
 *    STALE_EVENT, OWNS_SPACES (+ the list);
 *  - the purge, step by step, against a bystander whose data must survive;
 *  - what is retained on purpose (reports against the account, the report the
 *    account filed with its reporter nulled, the tombstone);
 *  - idempotency (a repeat returns the recorded status) and the status route.
 *
 * Harness TRUNCATEs app.* between tests; relay.* rows are cleaned here.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { finalizeEvent } from "nostr-tools";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";
import { deleteRelayEventsByPubkey, insertMusicEvent, insertRelayEvent } from "../helpers/relayEvents.js";
import { db } from "../../src/db/connection.js";
import { config } from "../../src/config.js";
import { getRedis } from "../../src/lib/redis.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { invites } from "../../src/db/schema/invites.js";
import { cachedProfiles } from "../../src/db/schema/profiles.js";
import { nip05Identities } from "../../src/db/schema/nip05.js";
import { reputation } from "../../src/db/schema/moderation.js";
import { relayTunnels } from "../../src/db/schema/relays.js";
import { blobs, blobOwners } from "../../src/db/schema/blobs.js";
import {
  notificationPreferences,
  notificationQueue,
  pushDevices,
  pushSubscriptions,
  watchedBy,
} from "../../src/db/schema/notifications.js";
import { accountDeletions, reports } from "../../src/db/schema/reports.js";
import { reportService } from "../../src/services/reportService.js";
import { accountDeletionService } from "../../src/services/accountDeletionService.js";
import { authorBlocked } from "../../src/workers/ingestHandlers.js";

let server: FastifyInstance;
beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await deleteRelayEventsByPubkey([MARCUS.pubkey, SAGE.pubkey, LUNA.pubkey]);
  await db.execute(sql`DELETE FROM relay.group_members WHERE group_id = 'acct-group'`);
  await db.execute(sql`DELETE FROM relay.groups WHERE group_id = 'acct-group'`);
  await closeTestServer();
});
beforeEach(async () => {
  await deleteRelayEventsByPubkey([MARCUS.pubkey, SAGE.pubkey, LUNA.pubkey]);
  await getRedis().flushdb();
});

const now = () => Math.floor(Date.now() / 1000);

function vanish(sk: Uint8Array, over: { kind?: number; tags?: string[][]; created_at?: number } = {}) {
  return finalizeEvent(
    { kind: over.kind ?? 62, created_at: over.created_at ?? now(), tags: over.tags ?? [["relay", "ALL_RELAYS"]], content: "" },
    sk,
  );
}

function del(pubkey: string | null, payload: Record<string, unknown>) {
  return server.inject({
    method: "DELETE",
    url: "/account",
    headers: pubkey ? { "x-auth-pubkey": pubkey } : {},
    payload,
  });
}

async function count(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

describe("DELETE /account — validation", () => {
  it("requires NIP-98 auth and the confirm phrase", async () => {
    expect((await del(null, { confirm: "delete-account", vanishEvent: vanish(MARCUS.secretKey) })).statusCode).toBe(401);
    expect((await del(MARCUS.pubkey, { vanishEvent: vanish(MARCUS.secretKey) })).statusCode).toBe(400);
    expect((await del(MARCUS.pubkey, { confirm: "yes", vanishEvent: vanish(MARCUS.secretKey) })).statusCode).toBe(400);
  });

  it("rejects a bad signature, someone else's vanish, the wrong kind / relay, a stale event", async () => {
    const good = vanish(MARCUS.secretKey);
    const cases: Array<[Record<string, unknown>, number, string]> = [
      [{ ...good, content: "tampered" }, 400, "INVALID_EVENT"],
      [vanish(LUNA.secretKey), 403, "FORBIDDEN"],
      [vanish(MARCUS.secretKey, { kind: 5 }), 400, "INVALID_VANISH_TARGET"],
      [vanish(MARCUS.secretKey, { tags: [["relay", "wss://some.other.relay"]] }), 400, "INVALID_VANISH_TARGET"],
      [vanish(MARCUS.secretKey, { tags: [] }), 400, "INVALID_VANISH_TARGET"],
      [vanish(MARCUS.secretKey, { created_at: now() - 20 * 60 }), 400, "STALE_EVENT"],
      [vanish(MARCUS.secretKey, { created_at: now() + 20 * 60 }), 400, "STALE_EVENT"],
    ];
    for (const [vanishEvent, status, code] of cases) {
      const res = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent });
      expect(res.statusCode, code).toBe(status);
      expect(res.json().code).toBe(code);
    }
    // Nothing was recorded by any rejected request.
    expect(await db.select().from(accountDeletions)).toHaveLength(0);
  });

  it("accepts a relay tag naming this relay instead of ALL_RELAYS", async () => {
    const res = await del(MARCUS.pubkey, {
      confirm: "delete-account",
      vanishEvent: vanish(MARCUS.secretKey, { tags: [["relay", `${config.publicRelayUrl}/`]] }),
    });
    expect(res.statusCode).toBe(200);
  });

  it("409 OWNS_SPACES lists the caller's spaces until ownedSpaces is chosen", async () => {
    await db.insert(spaces).values({
      id: "acct-owned",
      name: "Owned",
      hostRelay: "wss://relay.test",
      creatorPubkey: MARCUS.pubkey,
      createdAt: Date.now(),
    });
    const res = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: vanish(MARCUS.secretKey) });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "OWNS_SPACES", spaces: [{ id: "acct-owned", name: "Owned" }] });
  });
});

describe("DELETE /account — the purge", () => {
  it("deletes everything the operator holds for the account, and nothing of anyone else's", async () => {
    const pk = MARCUS.pubkey;
    const other = SAGE.pubkey;
    const t = now();

    // Outbound contact
    await db.insert(pushDevices).values([
      { id: "d1", pubkey: pk, provider: "expo", token: "ExponentPushToken[marcus]", platform: "ios" },
      { id: "d2", pubkey: other, provider: "expo", token: "ExponentPushToken[sage]", platform: "ios" },
    ]);
    await db.insert(pushSubscriptions).values({ id: "s1", pubkey: pk, endpoint: "https://push", p256dh: "k", auth: "a" });
    await db.insert(notificationQueue).values({ id: "q1", pubkey: pk, type: "reply", title: "t", body: "b" });
    await db.insert(notificationPreferences).values([
      { pubkey: pk },
      { pubkey: other, watchedPubkeys: [pk, LUNA.pubkey] },
    ]);
    await db.insert(watchedBy).values([
      { authorPubkey: pk, watcherPubkey: other },
      { authorPubkey: other, watcherPubkey: pk },
      { authorPubkey: LUNA.pubkey, watcherPubkey: other },
    ]);
    await getRedis().set(`notif:dm:${pk}`, "1");
    await getRedis().set(`notif:release:${pk}:31683:x:y`, "1");
    await getRedis().set(`listening_history:${pk}`, "1");
    await getRedis().set(`notif:dm:${other}`, "1");

    // Identity
    await db.insert(nip05Identities).values({ username: "marcus", pubkey: pk });
    await db.insert(cachedProfiles).values([
      { pubkey: pk, name: "marcus", fetchedAt: Date.now() },
      { pubkey: other, name: "sage", fetchedAt: Date.now() },
    ]);
    await db.insert(reputation).values({ pubkey: pk, score: 90 });
    await db.insert(relayTunnels).values({ ownerPubkey: pk, tunnelId: "tun", hostname: "x.relay.test" });

    // Spaces: one owned (deleted with ownedSpaces=delete), one joined.
    await db.insert(spaces).values([
      { id: "acct-mine", name: "Mine", hostRelay: "wss://relay.test", creatorPubkey: pk, createdAt: Date.now(), memberCount: 2 },
      { id: "acct-theirs", name: "Theirs", hostRelay: "wss://relay.test", creatorPubkey: other, createdAt: Date.now(), memberCount: 2 },
    ]);
    await db.insert(spaceMembers).values([
      { spaceId: "acct-mine", pubkey: pk },
      { spaceId: "acct-mine", pubkey: other },
      { spaceId: "acct-theirs", pubkey: pk },
      { spaceId: "acct-theirs", pubkey: other },
    ]);
    await db.insert(invites).values({ code: "inv-m", spaceId: "acct-theirs", createdBy: pk });
    await db.execute(sql`INSERT INTO relay.groups (group_id) VALUES ('acct-group') ON CONFLICT DO NOTHING`);
    await db.execute(sql`INSERT INTO relay.group_members (group_id, pubkey) VALUES ('acct-group', ${pk}), ('acct-group', ${other})`);

    // Music + blobs: a blob only they own goes; a shared blob stays for the co-owner.
    const trackId = await insertMusicEvent({ kind: 31683, pubkey: pk, slug: "acct-track" });
    await db.insert(blobs).values([
      { sha256: "a".repeat(64), size: 1, uploaded: t },
      { sha256: "b".repeat(64), size: 1, uploaded: t },
    ]);
    await db.insert(blobOwners).values([
      { sha256: "a".repeat(64), pubkey: pk },
      { sha256: "b".repeat(64), pubkey: pk },
      { sha256: "b".repeat(64), pubkey: other },
    ]);

    // Relay events: theirs before the vanish (gone), a wrap addressed to
    // them (gone), the bystander's own (kept).
    const theirNote = finalizeEvent({ kind: 1, created_at: t - 60, tags: [], content: "mine" }, MARCUS.secretKey);
    const wrapToThem = finalizeEvent({ kind: 1059, created_at: t - 3600, tags: [["p", pk]], content: "x" }, SAGE.secretKey);
    const bystanderNote = finalizeEvent({ kind: 1, created_at: t - 60, tags: [["p", pk]], content: "hi marcus" }, SAGE.secretKey);
    for (const ev of [theirNote, wrapToThem, bystanderNote]) await insertRelayEvent(ev);

    // Reports: one they filed (kept, reporter nulled), one against them (kept).
    const filed = await reportService.file({
      source: "nostr", reporterPubkey: pk, reporterIpHash: null, targetType: "user", targetEventId: null,
      targetCoordinate: null, targetPubkey: other, targetKind: null, targetContext: null, category: "spam",
      note: null, reportEventId: null,
    });
    const against = await reportService.file({
      source: "nostr", reporterPubkey: other, reporterIpHash: null, targetType: "user", targetEventId: null,
      targetCoordinate: null, targetPubkey: pk, targetKind: null, targetContext: null, category: "harassment",
      note: null, reportEventId: null,
    });

    const vanishEvent = vanish(MARCUS.secretKey);
    const res = await del(pk, { confirm: "delete-account", vanishEvent, ownedSpaces: "delete" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.status).toBe("complete");
    expect(Date.parse(data.requestedAt)).not.toBeNaN();
    expect(Date.parse(data.completedAt)).not.toBeNaN();
    expect(Object.keys(data.deleted).sort()).toEqual(
      ["blobs", "identity", "memberships", "music", "outbound", "ownedSpaces", "relayEvents"].sort(),
    );

    // Outbound contact
    expect(await db.select().from(pushDevices).where(eq(pushDevices.pubkey, pk))).toHaveLength(0);
    expect(await db.select().from(pushDevices).where(eq(pushDevices.pubkey, other))).toHaveLength(1);
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
    expect(await db.select().from(notificationQueue).where(eq(notificationQueue.pubkey, pk))).toHaveLength(0);
    const prefs = await db.select().from(notificationPreferences);
    expect(prefs.map((p) => p.pubkey)).toEqual([other]);
    expect(prefs[0].watchedPubkeys).toEqual([LUNA.pubkey]);
    expect(await db.select().from(watchedBy)).toEqual([{ authorPubkey: LUNA.pubkey, watcherPubkey: other }]);
    expect(await getRedis().exists(`notif:dm:${pk}`, `notif:release:${pk}:31683:x:y`, `listening_history:${pk}`)).toBe(0);
    expect(await getRedis().exists(`notif:dm:${other}`)).toBe(1);

    // Identity
    expect(await db.select().from(nip05Identities)).toHaveLength(0);
    expect((await db.select().from(cachedProfiles)).map((p) => p.pubkey)).toEqual([other]);
    expect(await db.select().from(reputation)).toHaveLength(0);
    expect(await db.select().from(relayTunnels)).toHaveLength(0);

    // Spaces + memberships
    expect((await db.select().from(spaces)).map((s) => s.id)).toEqual(["acct-theirs"]);
    const [theirs] = await db.select().from(spaces).where(eq(spaces.id, "acct-theirs"));
    expect(theirs.memberCount).toBe(1);
    expect((await db.select().from(spaceMembers)).map((m) => m.pubkey)).toEqual([other]);
    expect(await db.select().from(invites)).toHaveLength(0);
    expect(
      await count(sql`SELECT COUNT(*)::int AS n FROM relay.group_members WHERE group_id = 'acct-group' AND pubkey = ${pk}`),
    ).toBe(0);
    expect(
      await count(sql`SELECT COUNT(*)::int AS n FROM relay.group_members WHERE group_id = 'acct-group' AND pubkey = ${other}`),
    ).toBe(1);

    // Music + blobs
    expect(await count(sql`SELECT COUNT(*)::int AS n FROM relay.events WHERE id = ${trackId}`)).toBe(0);
    expect((await db.select().from(blobs)).map((b) => b.sha256)).toEqual(["b".repeat(64)]);
    expect(await db.select().from(blobOwners)).toEqual([{ sha256: "b".repeat(64), pubkey: other }]);

    // Relay events
    expect(await count(sql`SELECT COUNT(*)::int AS n FROM relay.events WHERE id = ${theirNote.id}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*)::int AS n FROM relay.events WHERE id = ${wrapToThem.id}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*)::int AS n FROM relay.events WHERE id = ${bystanderNote.id}`)).toBe(1);

    // Retained on purpose
    const [filedAfter] = await db.select().from(reports).where(eq(reports.id, filed.report.id));
    expect(filedAfter.reporterPubkey).toBeNull();
    const [againstAfter] = await db.select().from(reports).where(eq(reports.id, against.report.id));
    expect(againstAfter.targetPubkey).toBe(pk);
    const [tomb] = await db.select().from(accountDeletions).where(eq(accountDeletions.pubkey, pk));
    expect(tomb).toMatchObject({ vanishEventId: vanishEvent.id, vanishCreatedAt: vanishEvent.created_at, status: "complete" });
    expect(tomb.vanishEvent).toMatchObject({ id: vanishEvent.id, kind: 62 });
  });

  it("is idempotent: a repeat returns the recorded deletion", async () => {
    const first = vanish(MARCUS.secretKey);
    const res1 = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: first });
    expect(res1.statusCode).toBe(200);
    const res2 = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: first });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().data.requestedAt).toBe(res1.json().data.requestedAt);

    const status = await server.inject({ method: "GET", url: "/account/deletion", headers: { "x-auth-pubkey": MARCUS.pubkey } });
    expect(status.json().data).toMatchObject({ status: "complete" });
    const none = await server.inject({ method: "GET", url: "/account/deletion", headers: { "x-auth-pubkey": LUNA.pubkey } });
    expect(none.json().data).toEqual({ status: "none" });
    expect((await server.inject({ method: "GET", url: "/account/deletion" })).statusCode).toBe(401);
  });

  it("a repeat with a newer vanish moves the cutoff and purges what was published in between", async () => {
    // What the simulator did: DELETE, the app kept publishing (10050, 30078),
    // then a second DELETE with a new kind 62, then the blank kind 0 (vanish − 1).
    const first = vanish(MARCUS.secretKey, { created_at: now() - 300 });
    const r1 = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: first });
    expect(r1.statusCode).toBe(200);

    const inBetween = finalizeEvent(
      { kind: 10050, created_at: now() - 120, tags: [["relay", "wss://x.test"]], content: "" },
      MARCUS.secretKey,
    );
    await insertRelayEvent(inBetween);
    // The first vanish as the client published it to the relay: it stays.
    await insertRelayEvent(first);
    await db.insert(cachedProfiles).values({ pubkey: MARCUS.pubkey, name: "back again", fetchedAt: Date.now() });

    const second = vanish(MARCUS.secretKey);
    const r2 = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: second });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().data.status).toBe("complete");
    const [row] = await db.select().from(accountDeletions).where(eq(accountDeletions.pubkey, MARCUS.pubkey));
    expect(row).toMatchObject({ vanishEventId: second.id, vanishCreatedAt: second.created_at, status: "complete" });
    expect(await count(sql`SELECT COUNT(*)::int AS n FROM relay.events WHERE id = ${inBetween.id}`)).toBe(0);
    expect(await count(sql`SELECT COUNT(*)::int AS n FROM relay.events WHERE id = ${first.id}`)).toBe(1);
    expect(await db.select().from(cachedProfiles)).toHaveLength(0);

    // The blank kind 0 the client publishes next (vanish − 1) is inside the
    // cutoff, so the ingester does not re-create the profile.
    accountDeletionService.invalidate();
    const blank = finalizeEvent(
      { kind: 0, created_at: second.created_at - 1, tags: [], content: JSON.stringify({ deleted: true }) },
      MARCUS.secretKey,
    );
    expect(await authorBlocked(blank)).toBe(true);

    // An OLDER vanish on a repeat never moves the cutoff back.
    await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: first });
    const [after] = await db.select().from(accountDeletions).where(eq(accountDeletions.pubkey, MARCUS.pubkey));
    expect(after.vanishEventId).toBe(second.id);
  });

  it("a repeat that re-runs the purge asks about spaces created since the first request", async () => {
    const r1 = await del(MARCUS.pubkey, {
      confirm: "delete-account",
      vanishEvent: vanish(MARCUS.secretKey, { created_at: now() - 60 }),
    });
    expect(r1.statusCode).toBe(200);
    await db.insert(spaces).values({
      id: "acct-late",
      name: "Made later",
      hostRelay: "wss://relay.test",
      creatorPubkey: MARCUS.pubkey,
      createdAt: Date.now(),
    });

    const ask = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: vanish(MARCUS.secretKey) });
    expect(ask.statusCode).toBe(409);
    expect(ask.json()).toMatchObject({ code: "OWNS_SPACES", spaces: [{ id: "acct-late" }] });

    const answer = await del(MARCUS.pubkey, {
      confirm: "delete-account",
      vanishEvent: vanish(MARCUS.secretKey),
      ownedSpaces: "delete",
    });
    expect(answer.statusCode).toBe(200);
    expect(await db.select().from(spaces).where(eq(spaces.id, "acct-late"))).toHaveLength(0);
    const [row] = await db.select().from(accountDeletions).where(eq(accountDeletions.pubkey, MARCUS.pubkey));
    expect(row.ownedSpaces).toBe("delete");
  });

  it("a retry of a pending deletion is not refused for age; a new stale event still is", async () => {
    // Recorded 20 minutes ago, left pending (a crash or a failed step).
    const old = vanish(MARCUS.secretKey, { created_at: now() - 20 * 60 });
    await db.insert(accountDeletions).values({
      pubkey: MARCUS.pubkey,
      vanishEventId: old.id,
      vanishCreatedAt: old.created_at,
      vanishEvent: old as unknown as Record<string, unknown>,
    });
    const stale = vanish(MARCUS.secretKey, { created_at: now() - 15 * 60 });
    expect((await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: stale })).json().code).toBe("STALE_EVENT");

    const retry = await del(MARCUS.pubkey, { confirm: "delete-account", vanishEvent: old });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.status).toBe("complete");
  });

  it("finishes a pending deletion on its own (the client never calls again)", async () => {
    const ev = vanish(SAGE.secretKey);
    await db.insert(accountDeletions).values({
      pubkey: SAGE.pubkey,
      vanishEventId: ev.id,
      vanishCreatedAt: ev.created_at,
      vanishEvent: ev as unknown as Record<string, unknown>,
    });
    await db.insert(cachedProfiles).values({ pubkey: SAGE.pubkey, name: "sage", fetchedAt: Date.now() });
    expect(await accountDeletionService.resumePending()).toBe(1);
    const [row] = await db.select().from(accountDeletions).where(eq(accountDeletions.pubkey, SAGE.pubkey));
    expect(row.status).toBe("complete");
    expect(await db.select().from(cachedProfiles)).toHaveLength(0);
    expect(await accountDeletionService.resumePending()).toBe(0);
  });

  it("ownedSpaces=orphan keeps the space for its remaining members, creator cleared", async () => {
    await db.insert(spaces).values({
      id: "acct-orphan",
      name: "Orphaned",
      hostRelay: "wss://relay.test",
      creatorPubkey: LUNA.pubkey,
      createdAt: Date.now(),
      memberCount: 2,
    });
    await db.insert(spaceMembers).values([
      { spaceId: "acct-orphan", pubkey: LUNA.pubkey },
      { spaceId: "acct-orphan", pubkey: SAGE.pubkey },
    ]);
    const res = await del(LUNA.pubkey, {
      confirm: "delete-account",
      vanishEvent: vanish(LUNA.secretKey),
      ownedSpaces: "orphan",
    });
    expect(res.statusCode).toBe(200);
    const [space] = await db.select().from(spaces).where(eq(spaces.id, "acct-orphan"));
    expect(space).toMatchObject({ creatorPubkey: null, memberCount: 1 });
    expect((await db.select().from(spaceMembers)).map((m) => m.pubkey)).toEqual([SAGE.pubkey]);
  });
});
