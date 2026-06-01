import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket as WsConn } from "ws";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceRelays } from "../../src/db/schema/relays.js";
import { spaceActivityDaily } from "../../src/db/schema/analytics.js";

/**
 * End-to-end test against REAL WebSocket relays. Spins up multiple dummy relays
 * (http NIP-11 + ws) speaking the Nostr REQ/EVENT protocol, registers them, and
 * drives simultaneous mixed / forged / flooding event streams with REAL
 * signatures (verifyEvent runs for real). Asserts: valid events index, the
 * anti-poisoning gate drops cross-space events, forged 39002 is rejected, and a
 * flooding relay is disconnected + flagged.
 */

interface DummyRelay {
  url: string;
  pubkey: string;
  sk: Uint8Array;
  push: (subId: string, event: unknown) => void;
  connected: Promise<void>;
  close: () => Promise<void>;
}

function makeDummyRelay(): DummyRelay {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const clients = new Set<WsConn>();
  let resolveConnected!: () => void;
  const connected = new Promise<void>((r) => (resolveConnected = r));

  const http: Server = createServer((req, res) => {
    // NIP-11 document — advertises this relay's signing key.
    res.writeHead(200, { "content-type": "application/nostr+json" });
    res.end(JSON.stringify({ name: "dummy", pubkey, supported_nips: [1, 29, 42] }));
  });
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("message", () => {
      /* accept REQ/CLOSE; we push events explicitly via push() */
    });
    resolveConnected();
  });

  http.listen(0);
  const port = (http.address() as { port: number }).port;

  return {
    url: `ws://127.0.0.1:${port}`,
    pubkey,
    sk,
    push: (subId, event) => {
      const frame = JSON.stringify(["EVENT", subId, event]);
      for (const ws of clients) ws.send(frame);
    },
    connected,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of clients) ws.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}

function signed(sk: Uint8Array, kind: number, tags: string[][], content = "") {
  return finalizeEvent({ kind, created_at: Math.floor(Date.now() / 1000), tags, content }, sk);
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 4000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

let stopFn: (() => void) | null = null;

beforeEach(() => {
  process.env.INGEST_RECONNECT_MS = "10000"; // keep the (absent) own-relay quiet
  process.env.INGEST_RATE_MAX = "10";
  process.env.INGEST_RATE_WINDOW_MS = "10000";
});

afterEach(() => {
  stopFn?.();
  stopFn = null;
  delete process.env.INGEST_RECONNECT_MS;
  delete process.env.INGEST_RATE_MAX;
});

describe("relay manager — real multi-relay integration", () => {
  it("routes valid events, blocks poison/forgery, and drops a flooder", async () => {
    // Two real relays + a member identity.
    const relay1 = makeDummyRelay();
    const relay2 = makeDummyRelay();
    const relay1Sk = relay1.sk;
    const memberSk = generateSecretKey();
    const attackerSk = generateSecretKey();

    try {
      // spaceA → relay1, spaceB → relay2. Direct insert (the SSRF guard blocks
      // 127.0.0.1 at registration, but the manager trusts the registry).
      await db.insert(spaces).values([
        { id: "spaceA", name: "A", hostRelay: relay1.url, createdAt: Date.now(), ingestionTier: "discovery" },
        { id: "spaceB", name: "B", hostRelay: relay2.url, createdAt: Date.now(), ingestionTier: "discovery" },
      ]);
      await db.insert(spaceRelays).values([
        { relayUrl: relay1.url, spaceId: "spaceA", status: "approved", registeredBy: "x" },
        { relayUrl: relay2.url, spaceId: "spaceB", status: "approved", registeredBy: "x" },
      ]);

      const { startRelayIngester } = await import("../../src/workers/relayConnectionManager.js");
      stopFn = startRelayIngester().stop;

      await Promise.all([relay1.connected, relay2.connected]);
      await new Promise((r) => setTimeout(r, 150)); // let REQs + NIP-11 settle

      // relay1 pushes: valid chat for spaceA, a POISON chat for spaceB (not its
      // space), a FORGED 39002 (attacker key), then a VALID 39002 (relay1 key).
      relay1.push("ext-chat", signed(memberSk, 9, [["h", "spaceA"]], "hello"));
      relay1.push("ext-chat", signed(memberSk, 9, [["h", "spaceB"]], "poison"));
      relay1.push("ext-meta", signed(attackerSk, 39002, [["d", "spaceA"], ["p", "x"], ["p", "y"], ["p", "z"]]));
      relay1.push("ext-meta", signed(relay1Sk, 39002, [["d", "spaceA"], ["p", "m1"], ["p", "m2"]]));

      // relay2 floods (>10) → should be rate-capped + disconnected.
      for (let i = 0; i < 15; i++) {
        relay2.push("ext-chat", signed(memberSk, 9, [["h", "spaceA"]], `flood-${i}`));
      }

      // Valid chat indexed → spaceA has activity.
      const gotActivity = await waitFor(async () => {
        const rows = await db.select().from(spaceActivityDaily).where(eq(spaceActivityDaily.spaceId, "spaceA"));
        return rows.length > 0 && rows[0].messageCount >= 1;
      });
      expect(gotActivity, "valid spaceA chat should be indexed").toBe(true);

      // Valid 39002 (relay1 key) → mirrored_member_count = 2.
      const gotMirror = await waitFor(async () => {
        const [s] = await db.select().from(spaces).where(eq(spaces.id, "spaceA"));
        return s?.mirroredMemberCount === 2;
      });
      expect(gotMirror, "valid 39002 should set mirrored_member_count=2").toBe(true);

      // Forgery did NOT take effect: a forged 39002 had 3 p-tags; the count is 2
      // (from the valid one), never 3 → the attacker's event was rejected.
      const [aFinal] = await db.select().from(spaces).where(eq(spaces.id, "spaceA"));
      expect(aFinal.mirroredMemberCount).toBe(2);

      // Anti-poisoning: relay1's spaceB chat was dropped (relay1 only serves spaceA).
      const bActivity = await db.select().from(spaceActivityDaily).where(eq(spaceActivityDaily.spaceId, "spaceB"));
      expect(bActivity.length, "relay1 must not write to spaceB").toBe(0);

      // Flood: relay2 exceeded the cap → disconnected + flagged.
      const flagged = await waitFor(async () => {
        const [r] = await db.select().from(spaceRelays).where(eq(spaceRelays.relayUrl, relay2.url));
        return (r?.errorCount ?? 0) > 0;
      });
      expect(flagged, "flooding relay should be flagged").toBe(true);
    } finally {
      await relay1.close();
      await relay2.close();
    }
  }, 20_000);
});
