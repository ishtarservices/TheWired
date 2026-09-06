import { describe, it, expect, beforeEach } from "vitest";
import { finalizeEvent } from "nostr-tools";
import { getRedis } from "../../src/lib/redis.js";
import {
  processEvent,
  recordZapReceipt,
  type IngestContext,
  type NostrEvent,
} from "../../src/workers/ingestHandlers.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

/**
 * `zap_total:` / `zap_count:` are all-time counters that feed the trending
 * score. The ingester does NOT see each receipt exactly once — relays replay on
 * reconnect, the same receipt can arrive over two connections, and a backfill
 * re-walks history — so a bare INCR permanently inflated whatever the receipt
 * paid for.
 *
 * These tests pin the property the fix relies on: replaying a receipt must be a
 * no-op, while a genuinely different receipt for the same target must still
 * count.
 */

const ownCtx: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };

const TARGET = "a".repeat(64);
const OTHER_TARGET = "b".repeat(64);

let clock = 1_800_000_000;

/** A signed kind:9735 whose description carries a kind:9734 with `amount` in msats. */
function zapReceipt(opts: { target: string; sats: number; user?: typeof LUNA }): NostrEvent {
  clock += 1;
  const request = JSON.stringify({ tags: [["amount", String(opts.sats * 1000)]] });
  return finalizeEvent(
    {
      kind: 9735,
      created_at: clock,
      tags: [
        ["e", opts.target],
        ["bolt11", "lnbc1fake"],
        ["description", request],
      ],
      content: "",
    },
    (opts.user ?? LUNA).secretKey,
  ) as NostrEvent;
}

async function counters(target: string) {
  const redis = getRedis();
  const [total, count] = await redis.mget(`zap_total:${target}`, `zap_count:${target}`);
  return { total: parseInt(total ?? "0", 10), count: parseInt(count ?? "0", 10) };
}

beforeEach(async () => {
  await getRedis().flushall();
});

describe("zap receipt ingest is idempotent", () => {
  it("counts a receipt once no matter how many times it is ingested", async () => {
    const receipt = zapReceipt({ target: TARGET, sats: 210 });

    await processEvent(receipt, ownCtx);
    const afterFirst = await counters(TARGET);
    expect(afterFirst).toEqual({ total: 210, count: 1 });

    // The regression: a replay used to add another 210 sats and another count.
    await processEvent(receipt, ownCtx);
    await processEvent(receipt, ownCtx);

    expect(await counters(TARGET)).toEqual(afterFirst);
  });

  it("still counts a second, distinct receipt for the same target", async () => {
    await processEvent(zapReceipt({ target: TARGET, sats: 100 }), ownCtx);
    await processEvent(zapReceipt({ target: TARGET, sats: 50, user: MARCUS }), ownCtx);

    expect(await counters(TARGET)).toEqual({ total: 150, count: 2 });
  });

  it("dedupes per receipt, not per target", async () => {
    const first = zapReceipt({ target: TARGET, sats: 10 });
    const second = zapReceipt({ target: OTHER_TARGET, sats: 20 });

    await processEvent(first, ownCtx);
    await processEvent(second, ownCtx);
    await processEvent(first, ownCtx);
    await processEvent(second, ownCtx);

    expect(await counters(TARGET)).toEqual({ total: 10, count: 1 });
    expect(await counters(OTHER_TARGET)).toEqual({ total: 20, count: 1 });
  });

  it("leaves the counters untouched when the receipt has no `e` tag", async () => {
    clock += 1;
    const noTarget = finalizeEvent(
      { kind: 9735, created_at: clock, tags: [["bolt11", "lnbc1fake"]], content: "" },
      LUNA.secretKey,
    ) as NostrEvent;

    await processEvent(noTarget, ownCtx);

    const redis = getRedis();
    expect(await redis.keys("zap_*")).toEqual([]);
  });
});

describe("recordZapReceipt", () => {
  it("reports whether the receipt was new", async () => {
    const redis = getRedis();
    expect(await recordZapReceipt(redis, "receipt-1", TARGET, 5)).toBe(true);
    expect(await recordZapReceipt(redis, "receipt-1", TARGET, 5)).toBe(false);
    expect(await recordZapReceipt(redis, "receipt-2", TARGET, 5)).toBe(true);

    expect(await counters(TARGET)).toEqual({ total: 10, count: 2 });
  });

  it("counts a zero-sat receipt once, without inflating the total", async () => {
    const redis = getRedis();
    await recordZapReceipt(redis, "receipt-0", TARGET, 0);
    await recordZapReceipt(redis, "receipt-0", TARGET, 0);

    expect(await counters(TARGET)).toEqual({ total: 0, count: 1 });
  });
});
