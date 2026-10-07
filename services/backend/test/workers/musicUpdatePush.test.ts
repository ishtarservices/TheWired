/**
 * `music_update` server push (WIR-171, the WIR-165 leftover). A newer
 * version of a saved track/project, ingested from the OWN relay, enqueues one
 * push per fan whose saved row was actually flagged — never the author, never
 * on a backfill re-ingest, never for a fan who turned "music updates" off,
 * and for a non-public event only for the fans it is addressed to.
 *
 * Harness TRUNCATEs app.* between tests. Needs Postgres `thewired_test`.
 * Redis is ioredis-mock (the per-address dedupe key is cleared per test).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { finalizeEvent } from "nostr-tools";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { notificationQueue, notificationPreferences } from "../../src/db/schema/notifications.js";
import { processEvent, type IngestContext, type NostrEvent } from "../../src/workers/ingestHandlers.js";
import { savedVersionService } from "../../src/services/savedVersionService.js";
import { getRedis } from "../../src/lib/redis.js";
import { LUNA, MARCUS, SAGE } from "../helpers/testUsers.js";

const own: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
const ext: IngestContext = { relayUrl: "wss://ext", isOwnRelay: false, allowedSpaceIds: new Set(["x"]) };

const SLUG = "push-ep";
const ADDR = `33123:${MARCUS.pubkey}:${SLUG}`;
const T0 = 1_800_000_000;

function version(createdAt: number, extraTags: string[][] = [], kind = 33123): NostrEvent {
  return finalizeEvent(
    {
      kind,
      created_at: createdAt,
      tags: [["d", SLUG], ["title", "EP One"], ...extraTags],
      content: "",
    },
    MARCUS.secretKey,
  ) as NostrEvent;
}

const rowsFor = (pubkey: string) =>
  db.select().from(notificationQueue).where(eq(notificationQueue.pubkey, pubkey));

beforeEach(async () => {
  const redis = getRedis();
  const keys = await redis.keys("notif:*");
  if (keys.length > 0) await redis.del(...keys);
});

describe("music_update push through processEvent", () => {
  it("pushes once to a fan whose saved version is older, with the deep link and address", async () => {
    const v1 = version(T0);
    await savedVersionService.save(LUNA.pubkey, ADDR, v1.id, v1.created_at);

    const v2 = version(T0 + 100);
    await processEvent(v2, own);

    const rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "music_update",
      body: "updated project: EP One",
      url: `soot://music/album/${ADDR}`,
      collapseKey: `music_update:${LUNA.pubkey}`,
    });
    expect(JSON.parse(rows[0].data!)).toEqual({
      address: ADDR,
      actor: MARCUS.pubkey,
      kind: 33123,
      eventId: v2.id,
    });

    // Backfill re-ingest of the same event: the row is already flagged → no second push.
    await processEvent(v2, own);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });

  it("uses the track noun and link for a 31683", async () => {
    const v1 = version(T0, [], 31683);
    const addr = `31683:${MARCUS.pubkey}:${SLUG}`;
    await savedVersionService.save(LUNA.pubkey, addr, v1.id, v1.created_at);
    await processEvent(version(T0 + 100, [], 31683), own);

    const rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: "updated track: EP One", url: `soot://music/track/${addr}` });
  });

  it("never pushes the author for their own edit, nor a fan already on the newest version", async () => {
    const v1 = version(T0);
    await savedVersionService.save(MARCUS.pubkey, ADDR, v1.id, v1.created_at);
    const v2 = version(T0 + 100);
    await savedVersionService.save(LUNA.pubkey, ADDR, v2.id, v2.created_at);

    await processEvent(v2, own);
    expect(await rowsFor(MARCUS.pubkey)).toHaveLength(0);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
  });

  it("honours the musicUpdates preference", async () => {
    const v1 = version(T0);
    await savedVersionService.save(LUNA.pubkey, ADDR, v1.id, v1.created_at);
    await db.insert(notificationPreferences).values({ pubkey: LUNA.pubkey, musicUpdates: false });

    await processEvent(version(T0 + 100), own);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
    // The flag itself still lands — only the push is gated.
    const row = (await savedVersionService.list(LUNA.pubkey)).find((r) => r.addressableId === ADDR);
    expect(row?.hasUpdate).toBe(true);
  });

  it("a non-public event pushes only the fans it is addressed to", async () => {
    const v1 = version(T0);
    await savedVersionService.save(LUNA.pubkey, ADDR, v1.id, v1.created_at);
    await savedVersionService.save(SAGE.pubkey, ADDR, v1.id, v1.created_at);

    await processEvent(
      version(T0 + 100, [["visibility", "private"], ["p", SAGE.pubkey, "", "collaborator"]]),
      own,
    );
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
    expect(await rowsFor(SAGE.pubkey)).toHaveLength(1);
  });

  it("one push per fan per address per day, even across two quick edits", async () => {
    const v1 = version(T0);
    await savedVersionService.save(LUNA.pubkey, ADDR, v1.id, v1.created_at);
    await processEvent(version(T0 + 100), own);
    await processEvent(version(T0 + 200), own);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });

  it("an external relay never flags or pushes (music is own-relay only)", async () => {
    const v1 = version(T0);
    await savedVersionService.save(LUNA.pubkey, ADDR, v1.id, v1.created_at);
    await processEvent(version(T0 + 100), ext);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
    const row = (await savedVersionService.list(LUNA.pubkey)).find((r) => r.addressableId === ADDR);
    expect(row?.hasUpdate).toBe(false);
  });
});
