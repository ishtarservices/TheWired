/**
 * The DB lookups behind foreign-report classification: which rows make an
 * account "an app user", when a reported event counts as "here", what counts
 * as content, and that a failed lookup keeps the report (fail-open).
 *
 * Harness TRUNCATEs app.* between tests; relay.events is not, so every relay
 * row here uses file-unique pubkeys and is deleted in afterAll.
 */
import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/connection.js";
import { config } from "../../src/config.js";
import { nip05Identities } from "../../src/db/schema/nip05.js";
import { pushDevices, pushSubscriptions } from "../../src/db/schema/notifications.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { reports } from "../../src/db/schema/reports.js";
import { deleteRelayEventsByPubkey, insertRelayEvent, resetRelayModeration } from "../helpers/relayEvents.js";
import {
  classifyOrigin,
  hasContentHere,
  isAppUser,
  ownRelayKeys,
  targetEventHere,
} from "../../src/services/reportFootprint.js";
import type { ReportInput } from "../../src/lib/reports/reportInput.js";

const mutableConfig = config as unknown as { relayUrl: string; publicRelayUrl: string };
const savedRelayUrl = config.relayUrl;
const savedPublicRelayUrl = config.publicRelayUrl;
mutableConfig.relayUrl = "ws://127.0.0.1:7777";
mutableConfig.publicRelayUrl = "wss://relay.thewired.app";

/** File-unique pubkeys (relay.events is shared across test files). */
const pk = (n: number) => `f0${n.toString(16).padStart(2, "0")}`.padEnd(64, "0");
const USED = Array.from({ length: 32 }, (_, i) => pk(i));
let seq = 0;
const eid = () => `fe${(seq++).toString(16).padStart(4, "0")}`.padEnd(64, "0");

function relayRow(pubkey: string, kind: number, tags: string[][] = [], content = "") {
  return { id: eid(), pubkey, kind, tags, content, created_at: Math.floor(Date.now() / 1000) - seq, sig: "0".repeat(128) };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    source: "nostr",
    reporterPubkey: pk(20),
    reporterIpHash: null,
    targetType: "event",
    targetEventId: eid(),
    targetCoordinate: null,
    targetPubkey: pk(21),
    targetKind: 1,
    targetContext: null,
    category: "spam",
    note: null,
    reportEventId: eid(),
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await deleteRelayEventsByPubkey(USED);
  await resetRelayModeration();
  mutableConfig.relayUrl = savedRelayUrl;
  mutableConfig.publicRelayUrl = savedPublicRelayUrl;
});

describe("ownRelayKeys", () => {
  it("covers both the internal and the public relay URL", () => {
    expect([...ownRelayKeys()].sort()).toEqual(["127.0.0.1:7777", "relay.thewired.app"]);
  });
});

describe("isAppUser", () => {
  it("is false for an unknown account and for malformed input", async () => {
    expect(await isAppUser(pk(0))).toBe(false);
    expect(await isAppUser(null)).toBe(false);
    expect(await isAppUser("")).toBe(false);
    expect(await isAppUser("not-hex")).toBe(false);
    expect(await isAppUser(pk(0).toUpperCase())).toBe(false);
    expect(await isAppUser(`${pk(0)}'; DROP TABLE app.reports; --`)).toBe(false);
  });

  it("is true for a nip05 name", async () => {
    await db.insert(nip05Identities).values({ username: "fp-one", pubkey: pk(1) });
    expect(await isAppUser(pk(1))).toBe(true);
  });

  it("is true for a mobile push device", async () => {
    await db.insert(pushDevices).values({ id: "fp-dev", pubkey: pk(2), provider: "expo", token: "fp-token", platform: "ios" });
    expect(await isAppUser(pk(2))).toBe(true);
  });

  it("is true for a web push subscription", async () => {
    await db.insert(pushSubscriptions).values({ id: "fp-sub", pubkey: pk(3), endpoint: "https://push.example/fp", p256dh: "k", auth: "a" });
    expect(await isAppUser(pk(3))).toBe(true);
  });

  it("is true for a member of a backend space", async () => {
    await db.insert(spaces).values({ id: "fp-space", hostRelay: "wss://relay.thewired.app", name: "fp", createdAt: Date.now() });
    await db.insert(spaceMembers).values({ spaceId: "fp-space", pubkey: pk(4) });
    expect(await isAppUser(pk(4))).toBe(true);
  });

  it("is true after a report filed through the app (HTTP), not after one that arrived over the relay", async () => {
    await db.insert(reports).values({
      id: "fp-http", source: "http", reporterPubkey: pk(5), targetType: "user", targetPubkey: pk(0), category: "spam",
    });
    await db.insert(reports).values({
      id: "fp-nostr", source: "nostr", reporterPubkey: pk(6), targetType: "user", targetPubkey: pk(0), category: "spam",
      reportEventId: eid(),
    });
    expect(await isAppUser(pk(5))).toBe(true);
    expect(await isAppUser(pk(6))).toBe(false);
  });

  it("is true for an own kind 10050 naming this relay in any spelling", async () => {
    await insertRelayEvent(relayRow(pk(7), 10050, [["relay", "wss://relay.damus.io"], ["relay", "WSS://Relay.TheWired.app/"]]));
    await insertRelayEvent(relayRow(pk(8), 10050, [["relay", "ws://127.0.0.1:7777"]]));
    expect(await isAppUser(pk(7))).toBe(true);
    expect(await isAppUser(pk(8))).toBe(true);
  });

  it("is true for an own kind 10002 `r` tag naming this relay, false for one that names only others", async () => {
    await insertRelayEvent(relayRow(pk(9), 10002, [["r", "wss://nos.lol", "read"], ["r", "wss://relay.thewired.app:443", "write"]]));
    await insertRelayEvent(relayRow(pk(10), 10002, [["r", "wss://nos.lol"], ["r", "wss://relay.damus.io"]]));
    expect(await isAppUser(pk(9))).toBe(true);
    expect(await isAppUser(pk(10))).toBe(false);
  });

  it("judges the NEWEST list only: removing this relay from a later list opts out", async () => {
    const older = relayRow(pk(11), 10050, [["relay", "wss://relay.thewired.app"]]);
    older.created_at -= 1000;
    const newer = relayRow(pk(11), 10050, [["relay", "wss://relay.damus.io"]]);
    await insertRelayEvent(older);
    await insertRelayEvent(newer);
    expect(await isAppUser(pk(11))).toBe(false);
  });

  it("ignores lookalike hosts and someone else's list carrying our URL", async () => {
    await insertRelayEvent(relayRow(pk(12), 10050, [["relay", "wss://relay.thewired.app.evil.example"]]));
    // pk(13)'s list is published by pk(12) — a p-tag is not an own list.
    await insertRelayEvent(relayRow(pk(12), 10050, [["relay", "wss://relay.thewired.app"], ["p", pk(13)]]));
    expect(await isAppUser(pk(13))).toBe(false);
  });

  it("ignores a kind other than 10002/10050 that carries a relay tag", async () => {
    await insertRelayEvent(relayRow(pk(14), 1, [["relay", "wss://relay.thewired.app"]], "look at my relay"));
    expect(await isAppUser(pk(14))).toBe(false);
  });
});

describe("targetEventHere", () => {
  it("is true for a stored event id and false for an unknown or malformed one", async () => {
    const row = relayRow(pk(15), 1, [], "hello");
    await insertRelayEvent(row);
    expect(await targetEventHere({ targetEventId: row.id, targetCoordinate: null })).toBe(true);
    expect(await targetEventHere({ targetEventId: eid(), targetCoordinate: null })).toBe(false);
    expect(await targetEventHere({ targetEventId: "zz", targetCoordinate: null })).toBe(false);
    expect(await targetEventHere({ targetEventId: null, targetCoordinate: null })).toBe(false);
  });

  it("is true for an addressable coordinate the relay holds, false for a bad or absent one", async () => {
    await insertRelayEvent(relayRow(pk(16), 31683, [["d", "fp-song"]], "{}"));
    expect(await targetEventHere({ targetEventId: null, targetCoordinate: `31683:${pk(16)}:fp-song` })).toBe(true);
    expect(await targetEventHere({ targetEventId: null, targetCoordinate: `31683:${pk(16)}:other` })).toBe(false);
    expect(await targetEventHere({ targetEventId: null, targetCoordinate: "garbage" })).toBe(false);
    expect(await targetEventHere({ targetEventId: null, targetCoordinate: `1:${pk(16)}` })).toBe(false);
  });

  it("is true for an event this relay REMOVED (tombstone), restored or not", async () => {
    const removed = eid();
    await db.execute(
      sql`INSERT INTO relay.tombstones (event_id, pubkey, kind, event, removed_by) VALUES (${removed}, ${pk(17)}, 1, NULL, 'admin')`,
    );
    expect(await targetEventHere({ targetEventId: removed, targetCoordinate: null })).toBe(true);
    await db.execute(sql`UPDATE relay.tombstones SET restored_at = NOW() WHERE event_id = ${removed}`);
    expect(await targetEventHere({ targetEventId: removed, targetCoordinate: null })).toBe(true);
  });
});

describe("hasContentHere", () => {
  it("counts any kind but gift wraps and reports", async () => {
    await insertRelayEvent(relayRow(pk(18), 1059, [["p", pk(0)]], "cipher"));
    await insertRelayEvent(relayRow(pk(18), 1984, [["p", pk(0), "spam"]]));
    expect(await hasContentHere(pk(18))).toBe(false);
    await insertRelayEvent(relayRow(pk(18), 7, [["e", eid()]], "+"));
    expect(await hasContentHere(pk(18))).toBe(true);
  });

  it("is false for an unknown or malformed pubkey", async () => {
    expect(await hasContentHere(pk(19))).toBe(false);
    expect(await hasContentHere(null)).toBe(false);
    expect(await hasContentHere("nope")).toBe(false);
  });
});

describe("classifyOrigin", () => {
  it("is foreign when neither account nor the content is here", async () => {
    const v = await classifyOrigin(input());
    expect(v.origin).toBe("foreign");
  });

  it("is local as soon as one footprint signal holds", async () => {
    await db.insert(nip05Identities).values({ username: "fp-reporter", pubkey: pk(22) });
    expect((await classifyOrigin(input({ reporterPubkey: pk(22) }))).signals).toEqual(["reporter_app_user"]);

    const post = relayRow(pk(23), 1, [], "mine");
    await insertRelayEvent(post);
    const v = await classifyOrigin(input({ targetPubkey: pk(23), targetEventId: post.id }));
    expect(v.origin).toBe("local");
    expect(v.signals).toEqual(["target_event_here", "target_content_here"]);
  });

  it("never classifies an HTTP report, with no lookups", async () => {
    const spy = vi.spyOn(db, "execute");
    expect(await classifyOrigin(input({ source: "http" }))).toEqual({ origin: "local", signals: ["http_source"] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails open when a lookup throws: the report stays local, flagged", async () => {
    vi.spyOn(db, "execute").mockRejectedValue(new Error("relay schema gone"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await classifyOrigin(input())).toEqual({ origin: "local", signals: ["lookup_failed"] });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
