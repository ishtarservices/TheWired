/**
 * Notification preferences — the server-side push gate the mobile client
 * mirrors its local settings into. PUT is a partial upsert; watchedPubkeys
 * rewrites the watched_by inverted index in the same transaction.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, JAYDEE } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { watchedBy } from "../../src/db/schema/notifications.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});

const get = (pubkey?: string) =>
  server.inject({
    method: "GET",
    url: "/notifications/preferences",
    headers: pubkey ? { "x-auth-pubkey": pubkey } : {},
  });

const put = (pubkey: string, payload: Record<string, unknown>) =>
  server.inject({
    method: "PUT",
    url: "/notifications/preferences",
    headers: { "x-auth-pubkey": pubkey },
    payload,
  });

describe("/notifications/preferences", () => {
  it("requires auth and defaults to everything on", async () => {
    expect((await get()).statusCode).toBe(401);
    const res = await get(LUNA.pubkey);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({
      enabled: true,
      mentions: true,
      replies: true,
      reactions: true,
      zaps: true,
      releases: true,
      friendRequests: true,
      spaceModes: {},
      watchedPubkeys: [],
      dndUntil: null,
    });
  });

  it("partial PUT keeps untouched fields and round-trips the new ones", async () => {
    expect((await put(LUNA.pubkey, { zaps: false, spaceModes: { s1: "mentions" } })).statusCode).toBe(200);
    expect((await put(LUNA.pubkey, { dndUntil: 1_800_000_000_000 })).statusCode).toBe(200);
    const data = (await get(LUNA.pubkey)).json().data;
    expect(data.zaps).toBe(false);
    expect(data.replies).toBe(true);
    expect(data.spaceModes).toEqual({ s1: "mentions" });
    expect(data.dndUntil).toBe(1_800_000_000_000);

    expect((await put(LUNA.pubkey, { dndUntil: null })).statusCode).toBe(200);
    expect((await get(LUNA.pubkey)).json().data.dndUntil).toBeNull();
  });

  it("validates modes, pubkeys and sizes", async () => {
    expect((await put(LUNA.pubkey, { spaceModes: { s1: "loud" } })).statusCode).toBe(400);
    expect((await put(LUNA.pubkey, { watchedPubkeys: ["not-hex"] })).statusCode).toBe(400);
    expect((await put(LUNA.pubkey, { dndUntil: -1 })).statusCode).toBe(400);
    expect(
      (await put(LUNA.pubkey, { watchedPubkeys: Array.from({ length: 501 }, (_, i) => i.toString(16).padStart(64, "0")) }))
        .statusCode,
    ).toBe(400);
  });

  it("watchedPubkeys rewrites the inverted index for this watcher only", async () => {
    await put(LUNA.pubkey, { watchedPubkeys: [MARCUS.pubkey, JAYDEE.pubkey, MARCUS.pubkey] });
    await put(JAYDEE.pubkey, { watchedPubkeys: [MARCUS.pubkey] });

    let rows = await db.select().from(watchedBy).where(eq(watchedBy.authorPubkey, MARCUS.pubkey));
    expect(rows.map((r) => r.watcherPubkey).sort()).toEqual([JAYDEE.pubkey, LUNA.pubkey].sort());
    expect((await get(LUNA.pubkey)).json().data.watchedPubkeys).toEqual([MARCUS.pubkey, JAYDEE.pubkey]);

    // LUNA drops MARCUS; JAYDEE's watch survives.
    await put(LUNA.pubkey, { watchedPubkeys: [JAYDEE.pubkey] });
    rows = await db.select().from(watchedBy).where(eq(watchedBy.authorPubkey, MARCUS.pubkey));
    expect(rows.map((r) => r.watcherPubkey)).toEqual([JAYDEE.pubkey]);

    // A PUT without watchedPubkeys leaves the index alone.
    await put(LUNA.pubkey, { zaps: false });
    rows = await db.select().from(watchedBy).where(eq(watchedBy.watcherPubkey, LUNA.pubkey));
    expect(rows.map((r) => r.authorPubkey)).toEqual([JAYDEE.pubkey]);
  });

  it("a failed watched_by rewrite rolls the whole PUT back", async () => {
    // A trigger that rejects one specific author simulates a mid-transaction
    // insert failure AFTER the delete of the old rows: everything — the
    // preference upsert and the index delete — must roll back together.
    const POISON = "f".repeat(64);
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION app.reject_poison_watch() RETURNS trigger AS $$
      BEGIN
        IF NEW.author_pubkey = '${sql.raw(POISON)}' THEN
          RAISE EXCEPTION 'poison author';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.execute(sql`
      CREATE TRIGGER poison_watch_guard BEFORE INSERT ON app.watched_by
      FOR EACH ROW EXECUTE FUNCTION app.reject_poison_watch()`);
    try {
      expect((await put(LUNA.pubkey, { watchedPubkeys: [MARCUS.pubkey] })).statusCode).toBe(200);

      const res = await put(LUNA.pubkey, { zaps: false, watchedPubkeys: [JAYDEE.pubkey, POISON] });
      expect(res.statusCode).toBe(500);

      // The old watch survives (the delete rolled back) and the preference
      // change from the same request was not applied.
      const rows = await db.select().from(watchedBy).where(eq(watchedBy.watcherPubkey, LUNA.pubkey));
      expect(rows.map((r) => r.authorPubkey)).toEqual([MARCUS.pubkey]);
      const data = (await get(LUNA.pubkey)).json().data;
      expect(data.zaps).toBe(true);
      expect(data.watchedPubkeys).toEqual([MARCUS.pubkey]);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS poison_watch_guard ON app.watched_by`);
      await db.execute(sql`DROP FUNCTION IF EXISTS app.reject_poison_watch()`);
    }
  });
});
