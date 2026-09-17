/**
 * Mobile push device registration + client-declared suppression.
 *
 * - POST /push/devices upserts on TOKEN and rebinds the pubkey (a shared
 *   phone that switched accounts without a clean logout must not keep
 *   pushing the previous user).
 * - DELETE /push/devices only removes a token the caller owns.
 * - POST /push/suppress is scoped to the caller's own pubkey.
 *
 * Harness TRUNCATEs app.* between tests → build state inline.
 * Needs Postgres `thewired_test` (pnpm dev:infra). Redis is ioredis-mock.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { pushDevices } from "../../src/db/schema/notifications.js";
import { pushService } from "../../src/services/pushService.js";

let server: FastifyInstance;
const TOKEN = "ExponentPushToken[abc123_-XYZ]";

beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});

async function register(pubkey: string, over: Record<string, unknown> = {}) {
  return server.inject({
    method: "POST",
    url: "/push/devices",
    headers: { "x-auth-pubkey": pubkey },
    payload: { provider: "expo", token: TOKEN, platform: "ios", appVersion: "0.1.0", ...over },
  });
}

describe("POST /push/devices", () => {
  it("rejects anonymous callers and malformed expo tokens", async () => {
    const anon = await server.inject({
      method: "POST",
      url: "/push/devices",
      payload: { provider: "expo", token: TOKEN, platform: "ios" },
    });
    expect(anon.statusCode).toBe(401);

    const bad = await register(LUNA.pubkey, { token: "not-a-token" });
    expect(bad.statusCode).toBe(400);
    const badPlatform = await register(LUNA.pubkey, { platform: "web" });
    expect(badPlatform.statusCode).toBe(400);
  });

  it("registers once, heartbeats on re-register, and rebinds to a new pubkey", async () => {
    const first = await register(LUNA.pubkey);
    expect(first.statusCode).toBe(200);
    const id = first.json().data.id;
    expect(id).toBeTruthy();

    const again = await register(LUNA.pubkey, { appVersion: "0.2.0" });
    expect(again.statusCode).toBe(200);
    let rows = await db.select().from(pushDevices).where(eq(pushDevices.token, TOKEN));
    expect(rows).toHaveLength(1);
    expect(rows[0].appVersion).toBe("0.2.0");
    expect(rows[0].pubkey).toBe(LUNA.pubkey);

    // MARCUS signs in on the same phone: the token now belongs to him.
    const rebound = await register(MARCUS.pubkey);
    expect(rebound.statusCode).toBe(200);
    rows = await db.select().from(pushDevices).where(eq(pushDevices.token, TOKEN));
    expect(rows).toHaveLength(1);
    expect(rows[0].pubkey).toBe(MARCUS.pubkey);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(0);
  });
});

describe("DELETE /push/devices", () => {
  it("removes only the caller's own token", async () => {
    await register(LUNA.pubkey);

    const anon = await server.inject({ method: "DELETE", url: "/push/devices", payload: { token: TOKEN } });
    expect(anon.statusCode).toBe(401);

    const other = await server.inject({
      method: "DELETE",
      url: "/push/devices",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { token: TOKEN },
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().data.removed).toBe(false);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(1);

    const own = await server.inject({
      method: "DELETE",
      url: "/push/devices",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { token: TOKEN },
    });
    expect(own.json().data.removed).toBe(true);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(0);
  });
});

describe("POST /push/suppress", () => {
  const EVENT = "e".repeat(64);

  it("records ids under the caller's own pubkey only", async () => {
    const anon = await server.inject({ method: "POST", url: "/push/suppress", payload: { eventIds: [EVENT] } });
    expect(anon.statusCode).toBe(401);

    const bad = await server.inject({
      method: "POST",
      url: "/push/suppress",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { eventIds: ["nope"] },
    });
    expect(bad.statusCode).toBe(400);

    const ok = await server.inject({
      method: "POST",
      url: "/push/suppress",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { eventIds: [EVENT] },
    });
    expect(ok.statusCode).toBe(200);
    expect(await pushService.isSuppressed(LUNA.pubkey, EVENT)).toBe(true);
    expect(await pushService.isSuppressed(MARCUS.pubkey, EVENT)).toBe(false);
    expect(await pushService.isSuppressed(LUNA.pubkey, "f".repeat(64))).toBe(false);
  });

  it("caps the batch size", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/push/suppress",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { eventIds: Array.from({ length: 21 }, (_, i) => i.toString(16).padStart(64, "0")) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("pushService housekeeping", () => {
  it("prunes devices not seen for N days and deletes dead tokens", async () => {
    await register(LUNA.pubkey);
    await db
      .update(pushDevices)
      .set({ lastSeenAt: new Date(Date.now() - 100 * 24 * 3600 * 1000) })
      .where(eq(pushDevices.token, TOKEN));
    expect(await pushService.pruneStaleDevices(90)).toBe(1);

    await register(LUNA.pubkey);
    await pushService.deleteToken(TOKEN);
    expect(await pushService.devicesFor(LUNA.pubkey)).toHaveLength(0);
  });
});
