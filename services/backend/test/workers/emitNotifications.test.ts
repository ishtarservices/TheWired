/**
 * emitNotifications end-to-end through processEvent: real signed events, the
 * real preference gate, real queue rows. Covers the reply/mention/chat/dm
 * paths on the own relay, graceful degradation when relay.events has no row
 * for a parent, the h_tag publicness gate on reaction previews, wrap replay
 * dedupe, and that an external-relay context never queues anything.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 * relay.events is NOT truncated — rows seeded here use file-unique ids and
 * are deleted in afterAll. Redis is ioredis-mock.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { finalizeEvent } from "nostr-tools";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { notificationQueue } from "../../src/db/schema/notifications.js";
import { processEvent, type IngestContext, type NostrEvent } from "../../src/workers/ingestHandlers.js";
import { profileCacheService } from "../../src/services/profileCacheService.js";
import { pushService } from "../../src/services/pushService.js";
import { getRedis } from "../../src/lib/redis.js";
import { ensureRelayEventsTable } from "../helpers/relayEvents.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";
import { config } from "../../src/config.js";

const own: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
const ext: IngestContext = {
  relayUrl: "wss://ext",
  isOwnRelay: false,
  allowedSpaceIds: new Set(["emit-space"]),
};

const SPACE = "emit-space";
const seededRelayIds: string[] = [];

function signed(
  secretKey: Uint8Array,
  over: { kind: number; tags?: string[][]; content?: string },
): NostrEvent {
  return finalizeEvent(
    {
      kind: over.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: over.tags ?? [],
      content: over.content ?? "",
    },
    secretKey,
  ) as NostrEvent;
}

/** Seed a relay.events row the parent/preview lookup can hit. */
async function seedRelayRow(row: { pubkey: string; content: string; hTag?: string }): Promise<string> {
  await ensureRelayEventsTable();
  const id = createHash("sha256").update(`emit-notif:${randomUUID()}`).digest("hex");
  await db.execute(
    sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig, h_tag, h_tags)
        VALUES (${id}, ${row.pubkey}, 1, '[]'::jsonb, ${row.content},
                ${Math.floor(Date.now() / 1000)}, ${"0".repeat(128)},
                ${row.hTag ?? null},
                ${row.hTag ? sql`ARRAY[${row.hTag}]::text[]` : sql`'{}'::text[]`})`,
  );
  seededRelayIds.push(id);
  return id;
}

const rowsFor = (pubkey: string) =>
  db.select().from(notificationQueue).where(eq(notificationQueue.pubkey, pubkey));

beforeEach(async () => {
  // The redis mock is shared across tests in this file; clear the notif keys.
  const redis = getRedis();
  const keys = await redis.keys("notif:*");
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(async () => {
  for (const id of seededRelayIds) {
    await db.execute(sql`DELETE FROM relay.events WHERE id = ${id}`);
  }
});

describe("kind 1 through processEvent (own relay)", () => {
  it("degrades to a mention when the parent is not in relay.events, without throwing", async () => {
    const reply = signed(MARCUS.secretKey, {
      kind: 1,
      tags: [["e", "f".repeat(64), "", "root"], ["p", LUNA.pubkey]],
      content: "nice one",
    });
    await processEvent(reply, own);

    const rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "mention", body: "nice one", url: `soot://note/${reply.id}` });
  });

  it("detects a reply when the parent row exists and is authored by the recipient", async () => {
    const parentId = await seedRelayRow({ pubkey: LUNA.pubkey, content: "my note" });
    const reply = signed(MARCUS.secretKey, {
      kind: 1,
      tags: [["e", parentId, "", "root"], ["p", LUNA.pubkey]],
      content: "agreed",
    });
    await processEvent(reply, own);

    const rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "reply", url: `soot://note/${parentId}` });
  });
});

describe("kind 7 preview gate (own relay)", () => {
  it("previews a PUBLIC target for its author, but never an h-tagged one", async () => {
    const publicId = await seedRelayRow({ pubkey: LUNA.pubkey, content: "public words" });
    const spaceScopedId = await seedRelayRow({ pubkey: LUNA.pubkey, content: "private space words", hTag: SPACE });

    await processEvent(
      signed(MARCUS.secretKey, { kind: 7, tags: [["e", publicId], ["p", LUNA.pubkey]], content: "+" }),
      own,
    );
    await processEvent(
      signed(MARCUS.secretKey, { kind: 7, tags: [["e", spaceScopedId], ["p", LUNA.pubkey]], content: "+" }),
      own,
    );

    const rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(2);
    const byUrl = Object.fromEntries(rows.map((r) => [r.url, r]));
    expect(byUrl[`soot://note/${publicId}`].body).toBe("public words");
    // The h-tagged row's author still gets the push — but content-free.
    expect(byUrl[`soot://note/${spaceScopedId}`].body).toBe("");
    expect(JSON.stringify(rows)).not.toContain("private space words");
  });
});

describe("kind 9 space mention through processEvent", () => {
  it("names the sender and space on the own relay; an external relay queues nothing", async () => {
    await db.insert(spaces).values({
      id: SPACE,
      name: "neon dungeon",
      hostRelay: "wss://relay.test",
      createdAt: Date.now(),
    });
    await profileCacheService.upsert({
      pubkey: MARCUS.pubkey,
      createdAt: Math.floor(Date.now() / 1000),
      content: JSON.stringify({ name: "marcus" }),
    });

    const chat = signed(MARCUS.secretKey, {
      kind: 9,
      tags: [["h", SPACE], ["p", LUNA.pubkey]],
      content: "yo luna",
    });
    await processEvent(chat, own);

    const rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "chat",
      title: "marcus in neon dungeon",
      body: "yo luna",
      collapseKey: `space:${SPACE}:${LUNA.pubkey}`,
    });

    // Same event from an external relay (even one scoped to this space):
    // chat indexing may run, but notifications never do.
    await db.delete(notificationQueue).where(eq(notificationQueue.pubkey, LUNA.pubkey));
    await processEvent(chat, ext);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
  });
});

describe("kind 1059 wrap through processEvent", () => {
  it("queues one content-free dm row for the recipient, and a replay never re-queues", async () => {
    await pushService.registerDevice({
      pubkey: LUNA.pubkey,
      provider: "expo",
      token: "ExponentPushToken[emitluna]",
      platform: "ios",
    });
    // Ephemeral wrap author, backdated created_at (as NIP-59 prescribes).
    const wrap = finalizeEvent(
      {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000) - 24 * 3600,
        tags: [["p", LUNA.pubkey]],
        content: "opaque-ciphertext",
      },
      MARCUS.secretKey,
    ) as NostrEvent;

    await processEvent(wrap, own);
    let rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "dm", title: "soot", body: "new message", url: "soot://dm?segment=messages" });
    // Content-free: the wrap id + where to fetch it (DMPushData) — no sender,
    // no ciphertext.
    expect(JSON.parse(rows[0].data!)).toEqual({ type: "dm", eventId: wrap.id, relay: config.publicRelayUrl });
    expect(JSON.stringify(rows[0])).not.toContain("opaque-ciphertext");
    expect(JSON.stringify(rows[0])).not.toContain(wrap.pubkey);

    // Reconnect replay (the wraps REQ looks back 2 days): same wrap id again,
    // outside the dm rate window — still no second row.
    await getRedis().del(`notif:dm:${LUNA.pubkey}`);
    await processEvent(wrap, own);
    rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);

    // And from an external relay a wrap is dropped outright.
    await getRedis().del(`notif:dm:${LUNA.pubkey}`, `notif:wrap:${wrap.id}`);
    await db.delete(notificationQueue).where(eq(notificationQueue.pubkey, LUNA.pubkey));
    await processEvent(wrap, ext);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
  });

  it("never queues a self-published wrap (the relay flagged the sender's own copy)", async () => {
    await pushService.registerDevice({
      pubkey: LUNA.pubkey,
      provider: "expo",
      token: "ExponentPushToken[emitluna2]",
      platform: "ios",
    });
    const selfWrap = finalizeEvent(
      {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000) - 3600,
        tags: [["p", LUNA.pubkey]],
        content: "opaque-ciphertext",
      },
      MARCUS.secretKey,
    ) as NostrEvent;
    // The relay stored it from a socket authenticated as LUNA → self_published.
    await ensureRelayEventsTable();
    await db.execute(
      sql`INSERT INTO relay.events (id, pubkey, kind, tags, content, created_at, sig, h_tags, self_published)
          VALUES (${selfWrap.id}, ${selfWrap.pubkey}, 1059, '[]'::jsonb, '', ${selfWrap.created_at},
                  ${"0".repeat(128)}, '{}'::text[], TRUE)`,
    );
    seededRelayIds.push(selfWrap.id);

    await processEvent(selfWrap, own);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);

    // A wrap the relay did NOT flag (or has no row for) still pushes.
    const inbound = finalizeEvent(
      { kind: 1059, created_at: Math.floor(Date.now() / 1000) - 60, tags: [["p", LUNA.pubkey]], content: "x" },
      MARCUS.secretKey,
    ) as NostrEvent;
    await processEvent(inbound, own);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });
});
