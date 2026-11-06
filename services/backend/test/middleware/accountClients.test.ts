/**
 * X-Wired-Client → app.account_clients: the authContext hook records which of
 * our apps an authenticated request came from, throttled to one write per
 * pubkey+client+platform per 10 minutes, fire-and-forget.
 *
 * Harness TRUNCATEs app.* between tests; the in-memory throttle is reset here.
 * Needs Postgres `thewired_test` (pnpm dev:infra).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { accountClients } from "../../src/db/schema/accountClients.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  ACCOUNT_CLIENT_WRITE_INTERVAL_MS,
  WIRED_CLIENT_MAX_LENGTH,
  WriteThrottle,
  flushAccountClientWrites,
  parseWiredClient,
  recordAccountClient,
  resetAccountClientThrottle,
} from "../../src/services/accountClients.js";

let server: FastifyInstance;
const DESKTOP = "desktop/0.7.2 (macos)";

beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});
beforeEach(() => {
  resetAccountClientThrottle();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function hit(headers: Record<string, string>, url = "/health") {
  const res = await server.inject({ method: "GET", url, headers });
  await flushAccountClientWrites();
  return res;
}

async function rowsFor(pubkey: string) {
  return db.select().from(accountClients).where(eq(accountClients.pubkey, pubkey));
}

describe("parseWiredClient (unit)", () => {
  it("accepts <client>/<semver> with an optional (platform), for the allowlisted apps", () => {
    expect(parseWiredClient("desktop/0.7.2 (macos)")).toEqual({ client: "desktop", version: "0.7.2", platform: "macos" });
    expect(parseWiredClient("mobile/1.3.0 (ios)")).toEqual({ client: "mobile", version: "1.3.0", platform: "ios" });
    expect(parseWiredClient("mobile/1.3.0 (android)")).toEqual({ client: "mobile", version: "1.3.0", platform: "android" });
    expect(parseWiredClient("desktop/0.7.2")).toEqual({ client: "desktop", version: "0.7.2", platform: "" });
    expect(parseWiredClient("mobile/1.3.0-beta.2+42")).toEqual({ client: "mobile", version: "1.3.0-beta.2+42", platform: "" });
    expect(parseWiredClient("desktop/10.20.30")).toMatchObject({ version: "10.20.30" });
  });

  it("rejects empty, oversized, non-ASCII and injection-looking values", () => {
    const bad: Array<string | undefined> = [
      undefined,
      "",
      " ",
      "desktop/1.0.0 (macos)".padEnd(WIRED_CLIENT_MAX_LENGTH + 1, "x"),
      "desktop/1.0.0-" + "a".repeat(WIRED_CLIENT_MAX_LENGTH),
      "desktop/1.0.0 (macos)\nX-Auth-Pubkey: " + "a".repeat(64),
      "desktop/1.0.0\r\n",
      "desktop/1.0.0'; DROP TABLE app.account_clients; --",
      "desktop/1.0.0 (macos) OR 1=1",
      "desktop/../1.0.0",
      "desktop\\1.0.0",
      "desktop/1.0.0 (../etc)",
      "desktop/1.0.0 (macos) pubkey=" + "b".repeat(64),
      "desktop/1.0.0 (macos) (ios)",
      "desktop/1.0.0 (Mac OS)",
      "desktop/1.0.0 (ios)",
      "mobile/1.0.0 (macos)",
      "desktop/1.0.0 (freebsd)",
      "desktop/1.0.0 (macos)/extra",
      "desktop/1.0.0 (мак)",
      "дesktop/1.0.0",
      "desktop/1.0.0\u0000",
      "desktop/1.0.0 ",
      " desktop/1.0.0",
    ];
    for (const value of bad) expect(parseWiredClient(value), JSON.stringify(value)).toBeNull();
  });

  it("rejects unknown app names and non-semver versions", () => {
    for (const value of [
      "web/1.0.0",
      "curl/8.0.0",
      "Desktop/1.0.0",
      "DESKTOP/1.0.0",
      "desktop",
      "desktop/",
      "desktop/1",
      "desktop/1.0",
      "desktop/1.0.0.0",
      "desktop/v1.0.0",
      "desktop/01.0.0",
      "desktop/1.0.x",
      "desktop/latest",
      "desktop/1.0.0-",
      "desktop/1.0.0+",
      "/1.0.0",
      "1.0.0",
    ]) {
      expect(parseWiredClient(value), value).toBeNull();
    }
  });

  it("ignores a rejected value silently, without logging it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const poison = "desktop/1.0.0'; DROP TABLE app.account_clients; --";
    expect(recordAccountClient(LUNA.pubkey, poison)).toBe(false);
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": poison });
    for (const spy of [warn, log, error]) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
  });
});

describe("upsert", () => {
  it("creates the row with first_seen == last_seen on the first request", async () => {
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP });
    const rows = await rowsFor(LUNA.pubkey);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ pubkey: LUNA.pubkey, client: "desktop", platform: "macos", version: "0.7.2" });
    expect(rows[0].firstSeen.getTime()).toBe(rows[0].lastSeen.getTime());
  });

  it("a later request bumps last_seen (and version) only; first_seen never moves", async () => {
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP });
    const [first] = await rowsFor(LUNA.pubkey);
    // Make the clock visibly move for the TIMESTAMPTZ comparison.
    await db.execute(
      sql`UPDATE app.account_clients SET first_seen = first_seen - interval '1 hour', last_seen = last_seen - interval '1 hour'
          WHERE pubkey = ${LUNA.pubkey}`,
    );
    const [aged] = await rowsFor(LUNA.pubkey);

    resetAccountClientThrottle();
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": "desktop/0.7.3 (macos)" });
    const [after] = await rowsFor(LUNA.pubkey);
    expect(after.firstSeen.getTime()).toBe(aged.firstSeen.getTime());
    expect(after.lastSeen.getTime()).toBeGreaterThan(aged.lastSeen.getTime());
    expect(after.lastSeen.getTime()).toBeGreaterThanOrEqual(first.lastSeen.getTime());
    expect(after.version).toBe("0.7.3");
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });

  it("a different app or platform for the same pubkey gets its own row", async () => {
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP });
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": "desktop/0.7.2 (windows)" });
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": "mobile/1.0.0 (ios)" });
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": "mobile/1.0.0 (android)" });
    const rows = await rowsFor(LUNA.pubkey);
    expect(rows.map((r) => `${r.client}/${r.platform}`).sort()).toEqual([
      "desktop/macos",
      "desktop/windows",
      "mobile/android",
      "mobile/ios",
    ]);
    expect(await db.select().from(accountClients)).toHaveLength(4);
  });
});

describe("throttle", () => {
  it("does not hit the DB again for the same pubkey+client inside the window", async () => {
    const insert = vi.spyOn(db, "insert");
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP });
    expect(insert).toHaveBeenCalledTimes(1);

    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP });
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": "desktop/0.7.3 (macos)" }, "/health?x=1");
    expect(insert).toHaveBeenCalledTimes(1);
    const [row] = await rowsFor(LUNA.pubkey);
    expect(row.version).toBe("0.7.2");

    // Another pubkey, and another platform of the same pubkey, each write once.
    await hit({ "x-auth-pubkey": MARCUS.pubkey, "x-wired-client": DESKTOP });
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": "desktop/0.7.2 (linux)" });
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it("writes again once the window has elapsed (clock-driven)", async () => {
    const insert = vi.spyOn(db, "insert");
    const t0 = 1_700_000_000_000;
    expect(recordAccountClient(LUNA.pubkey, DESKTOP, t0)).toBe(true);
    expect(recordAccountClient(LUNA.pubkey, DESKTOP, t0 + ACCOUNT_CLIENT_WRITE_INTERVAL_MS - 1)).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(recordAccountClient(LUNA.pubkey, DESKTOP, t0 + ACCOUNT_CLIENT_WRITE_INTERVAL_MS)).toBe(true);
    expect(insert).toHaveBeenCalledTimes(2);
    await flushAccountClientWrites();
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });

  it("releases the key when the write fails so the next request retries", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const insert = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("db down");
    });
    // A synchronous throw from the builder is outside the promise chain; the
    // realistic failure is a rejected query, so simulate that shape.
    insert.mockRestore();
    const real = db.insert.bind(db);
    const failing = vi.spyOn(db, "insert").mockImplementationOnce((...args: Parameters<typeof db.insert>) => {
      const builder = real(...args);
      const values = builder.values.bind(builder);
      builder.values = ((...v: Parameters<typeof builder.values>) => {
        const q = values(...v);
        q.onConflictDoUpdate = (() => Promise.reject(new Error("db down"))) as unknown as typeof q.onConflictDoUpdate;
        return q;
      }) as typeof builder.values;
      return builder;
    });
    expect(recordAccountClient(LUNA.pubkey, DESKTOP, 1_700_000_000_000)).toBe(true);
    await flushAccountClientWrites();
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
    // Same instant: without the release this would be throttled.
    expect(recordAccountClient(LUNA.pubkey, DESKTOP, 1_700_000_000_000)).toBe(true);
    await flushAccountClientWrites();
    expect(failing).toHaveBeenCalledTimes(2);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });

  it("the in-memory map is bounded: a flood of distinct keys evicts the stalest", () => {
    const t = new WriteThrottle(3, 1000);
    expect(t.acquire("a", 1)).toBe(true);
    expect(t.acquire("b", 2)).toBe(true);
    expect(t.acquire("c", 3)).toBe(true);
    expect(t.size).toBe(3);
    // Fourth distinct key: "a" (stalest) goes, size stays at the bound.
    expect(t.acquire("d", 4)).toBe(true);
    expect(t.size).toBe(3);
    expect(t.has("a")).toBe(false);
    expect(t.has("b") && t.has("c") && t.has("d")).toBe(true);
    // Evicted key is writable again (no stale throttle survives eviction).
    expect(t.acquire("a", 5)).toBe(true);
    expect(t.has("b")).toBe(false);
    // Keys inside the window stay throttled and are not touched by churn.
    expect(t.acquire("c", 6)).toBe(false);
    for (let i = 0; i < 10_000; i++) t.acquire(`flood-${i}`, 100 + i);
    expect(t.size).toBe(3);
  });
});

describe("security", () => {
  it("writes nothing without a verified pubkey, even with a well-formed header", async () => {
    await hit({ "x-wired-client": DESKTOP });
    await hit({ "x-auth-pubkey": "", "x-wired-client": DESKTOP });
    await hit({ "x-auth-pubkey": "tooshort", "x-wired-client": DESKTOP });
    await hit({ "x-auth-pubkey": LUNA.pubkey.slice(0, 63) + "g", "x-wired-client": DESKTOP }); // 64 chars, caller still gets no row
    expect(await db.select().from(accountClients).where(eq(accountClients.pubkey, LUNA.pubkey))).toHaveLength(0);
    const all = await db.select().from(accountClients);
    // A 64-char value is accepted by authContext as-is today (it does not hex-check);
    // the point here: nothing is attributed to LUNA or MARCUS from an unauthenticated call.
    expect(all.every((r) => r.pubkey !== LUNA.pubkey && r.pubkey !== MARCUS.pubkey)).toBe(true);
  });

  it("the header carries no account reference: it cannot write for another pubkey", async () => {
    const forOther = `desktop/0.7.2 (macos) pubkey=${MARCUS.pubkey}`;
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": forOther });
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": `desktop/0.7.2 (${MARCUS.pubkey})` });
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": `desktop/0.7.2; x-auth-pubkey=${MARCUS.pubkey}` });
    expect(await rowsFor(MARCUS.pubkey)).toHaveLength(0);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);

    // A valid header is attributed to the verified pubkey only.
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP });
    expect(await rowsFor(MARCUS.pubkey)).toHaveLength(0);
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });

  it("a repeated header (array value) is ignored rather than parsed", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-auth-pubkey": LUNA.pubkey, "x-wired-client": [DESKTOP, "mobile/1.0.0 (ios)"] },
    });
    expect(res.statusCode).toBe(200);
    await flushAccountClientWrites();
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(0);
  });
});

describe("regression", () => {
  it("authContext still exposes the pubkey as before when the header is absent", async () => {
    // /push/devices is auth-gated: 401 without a pubkey, 400 (validation) with one.
    const anon = await server.inject({ method: "POST", url: "/push/devices", payload: {} });
    expect(anon.statusCode).toBe(401);
    const authed = await server.inject({
      method: "POST",
      url: "/push/devices",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: {},
    });
    expect(authed.statusCode).toBe(400);
    await flushAccountClientWrites();
    expect(await db.select().from(accountClients)).toHaveLength(0);
  });

  it("the request is not slowed or failed by the write: response returns before the row lands", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/health",
      headers: { "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP },
    });
    expect(res.statusCode).toBe(200);
    await flushAccountClientWrites();
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });

  it("migration 0037 applies over a DB that already has the earlier tables, and re-runs as a no-op", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    // The harness truncates app.schema_migrations between tests, so this run
    // sees every table already present (a prod DB at 0025+, ledger aside) and
    // must apply 0037 without tripping on 0001..0036.
    await runMigrations();
    expect(log.mock.calls.flat().join("\n")).toMatch(/Applied 0037_account_clients\.sql/);
    const applied = (await db.execute(
      sql`SELECT filename FROM app.schema_migrations WHERE filename IN ('0025_relay_tunnels.sql', '0037_account_clients.sql') ORDER BY filename`,
    )) as unknown as { filename: string }[];
    expect(applied.map((r) => r.filename)).toEqual(["0025_relay_tunnels.sql", "0037_account_clients.sql"]);

    // Fully migrated: a second run touches nothing and the table still works.
    log.mockClear();
    await runMigrations();
    expect(log.mock.calls.flat().join("\n")).toMatch(/Up to date/);
    await hit({ "x-auth-pubkey": LUNA.pubkey, "x-wired-client": DESKTOP });
    expect(await rowsFor(LUNA.pubkey)).toHaveLength(1);
  });
});

describe("privacy", () => {
  it("stores exactly pubkey, client, platform, version, first_seen, last_seen — no path, IP or user agent", async () => {
    const cols = (await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'app' AND table_name = 'account_clients' ORDER BY ordinal_position`,
    )) as unknown as { column_name: string }[];
    expect(cols.map((c) => c.column_name)).toEqual(["pubkey", "client", "platform", "version", "first_seen", "last_seen"]);

    const pk = (await db.execute(
      sql`SELECT a.attname FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'app.account_clients'::regclass AND i.indisprimary ORDER BY a.attnum`,
    )) as unknown as { attname: string }[];
    expect(pk.map((c) => c.attname)).toEqual(["pubkey", "client", "platform"]);

    await hit({
      "x-auth-pubkey": LUNA.pubkey,
      "x-wired-client": DESKTOP,
      "user-agent": "Mozilla/5.0 (secret UA)",
      "x-client-ip": "203.0.113.9",
      "x-forwarded-for": "203.0.113.9",
    }, "/health?from=/secret/path");
    const [row] = await rowsFor(LUNA.pubkey);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain("203.0.113");
    expect(Object.keys(row).sort()).toEqual(["client", "firstSeen", "lastSeen", "platform", "pubkey", "version"]);
  });
});
