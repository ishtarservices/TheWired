import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../src/db/connection.js";
import { trendingSnapshots } from "../../src/db/schema/feeds.js";
import { getRedis } from "../../src/lib/redis.js";
import { feedService } from "../../src/services/feedService.js";

/**
 * `/feeds/trending` accepts a `kind` query param, but getTrending dropped it on
 * the floor: a client asking for kind 22 got the mixed-kind snapshot list back,
 * silently. Snapshots are stored per kind, so honouring the param is a filter
 * on the existing rows — the ranking itself is untouched.
 */

let seq = 0;
async function snapshot(kind: number | null, score: number, period = "24h") {
  seq += 1;
  await db.insert(trendingSnapshots).values({
    id: `snap-${seq}`,
    period,
    kind,
    eventId: `event-${seq}`,
    score,
  });
  return `event-${seq}`;
}

beforeEach(async () => {
  await getRedis().flushall();
});

describe("feedService.getTrending — kind filter", () => {
  it("returns only the requested kind", async () => {
    const reel = await snapshot(22, 900);
    await snapshot(30023, 800);
    await snapshot(31683, 700);

    const results = await feedService.getTrending({ period: "24h", kind: 22, limit: 50 });

    expect(results.map((r) => r.eventId)).toEqual([reel]);
  });

  it("returns every kind when none is requested", async () => {
    await snapshot(22, 900);
    await snapshot(30023, 800);

    const results = await feedService.getTrending({ period: "24h", limit: 50 });

    expect(results).toHaveLength(2);
  });

  it("keeps the score ordering within the filtered kind", async () => {
    const low = await snapshot(22, 100);
    const high = await snapshot(22, 900);
    await snapshot(30023, 5000); // outranks both, but is a different kind

    const results = await feedService.getTrending({ period: "24h", kind: 22, limit: 50 });

    expect(results.map((r) => r.eventId)).toEqual([high, low]);
  });

  it("applies the kind filter on top of the period filter", async () => {
    const inPeriod = await snapshot(22, 100, "24h");
    await snapshot(22, 900, "7d");

    const results = await feedService.getTrending({ period: "24h", kind: 22, limit: 50 });

    expect(results.map((r) => r.eventId)).toEqual([inPeriod]);
  });

  it("returns nothing for a kind with no snapshots", async () => {
    await snapshot(22, 900);

    expect(await feedService.getTrending({ period: "24h", kind: 1, limit: 50 })).toEqual([]);
  });

  it("still routes a genre request to the per-genre Redis set", async () => {
    // The genre branch narrows to music tracks on its own and must keep winning.
    await getRedis().zadd("trending:music:tracks:genre:techno", 42, "genre-event");
    await snapshot(31683, 900);

    const results = await feedService.getTrending({
      period: "24h",
      kind: 31683,
      genre: "Techno",
      limit: 50,
    });

    expect(results).toEqual([{ eventId: "genre-event", score: 42 }]);
  });
});
