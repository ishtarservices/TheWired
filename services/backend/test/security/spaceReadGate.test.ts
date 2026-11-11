/**
 * Unlisted (invite-only) spaces: their roster, roles, channels, feed sources,
 * onboarding and full row are for members. SPACE_READ_GATE rolls it out:
 * `log` serves and logs, `enforce` answers 404 (and a trimmed space row).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, JAYDEE } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { invites } from "../../src/db/schema/invites.js";
import { config } from "../../src/config.js";
import { resetSpaceReadGateLogForTests } from "../../src/lib/spaceReadGate.js";

let server: FastifyInstance;
let savedGate: typeof config.spaceReadGate;

beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});
beforeEach(() => {
  savedGate = config.spaceReadGate;
  resetSpaceReadGateLogForTests();
});
afterEach(() => {
  config.spaceReadGate = savedGate;
  vi.restoreAllMocks();
});

const as = (pubkey: string) => ({ "x-auth-pubkey": pubkey });

async function seed(id: string, listed: boolean) {
  const res = await server.inject({
    method: "POST",
    url: "/spaces",
    headers: as(LUNA.pubkey),
    payload: { id, name: `Space ${id}`, hostRelay: "wss://relay.test.com" },
  });
  expect(res.statusCode).toBe(200);
  if (listed) await db.update(spaces).set({ listed: true }).where(eq(spaces.id, id));
  await db.insert(spaceMembers).values({ spaceId: id, pubkey: MARCUS.pubkey }).onConflictDoNothing();
}

const gatedRoutes = (id: string) => [
  `/spaces/${id}/members`,
  `/spaces/${id}/member-roles`,
  `/spaces/${id}/members/${LUNA.pubkey}/roles`,
  `/spaces/${id}/roles`,
  `/spaces/${id}/channels`,
  `/spaces/${id}/channels/layout`,
  `/spaces/${id}/feed-sources`,
  `/spaces/${id}/onboarding/preview`,
];

describe("GET /spaces", () => {
  it("lists only Discover-listed spaces, whatever the gate mode", async () => {
    config.spaceReadGate = "off";
    await seed("gate-listed", true);
    await seed("gate-unlisted", false);
    const res = await server.inject({ method: "GET", url: "/spaces?limit=100" });
    const ids = (res.json().data as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain("gate-listed");
    expect(ids).not.toContain("gate-unlisted");
  });
});

describe("enforce mode", () => {
  beforeEach(() => {
    config.spaceReadGate = "enforce";
  });

  it("answers 404 to strangers and anonymous callers for an unlisted space's data", async () => {
    await seed("gate-private", false);
    for (const url of gatedRoutes("gate-private")) {
      const anon = await server.inject({ method: "GET", url });
      expect(anon.statusCode, `anon ${url}`).toBe(404);
      const stranger = await server.inject({ method: "GET", url, headers: as(JAYDEE.pubkey) });
      expect(stranger.statusCode, `stranger ${url}`).toBe(404);
    }
  });

  it("serves members in full", async () => {
    await seed("gate-private", false);
    for (const url of gatedRoutes("gate-private")) {
      const res = await server.inject({ method: "GET", url, headers: as(MARCUS.pubkey) });
      expect(res.statusCode, url).toBe(200);
    }
    const row = await server.inject({ method: "GET", url: "/spaces/gate-private", headers: as(MARCUS.pubkey) });
    expect(row.json().data.creatorPubkey).toBe(LUNA.pubkey);
    expect(row.json().data.hostRelay).toBe("wss://relay.test.com");
  });

  it("serves a listed space to anyone", async () => {
    await seed("gate-open", true);
    for (const url of gatedRoutes("gate-open")) {
      const res = await server.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
    }
    const row = await server.inject({ method: "GET", url: "/spaces/gate-open" });
    expect(row.json().data.creatorPubkey).toBe(LUNA.pubkey);
  });

  it("shows a stranger only the invite-preview fields of an unlisted space", async () => {
    await seed("gate-private", false);
    const res = await server.inject({ method: "GET", url: "/spaces/gate-private", headers: as(JAYDEE.pubkey) });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().data).sort()).toEqual(["about", "id", "memberCount", "mode", "name", "picture"]);
  });

  it("leaves spaces the backend doesn't know alone", async () => {
    const res = await server.inject({ method: "GET", url: "/spaces/never-made/channels" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("trims the public invite preview", async () => {
    await seed("gate-private", false);
    await db.insert(invites).values({ code: "gateinv1", spaceId: "gate-private", createdBy: LUNA.pubkey, label: "vip" });
    const res = await server.inject({ method: "GET", url: "/invites/gateinv1" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.code).toBe("gateinv1");
    expect(data.spaceId).toBe("gate-private");
    expect(data.space.name).toBe("Space gate-private");
    expect(data).not.toHaveProperty("createdBy");
    expect(data).not.toHaveProperty("autoAssignRole");
    expect(data).not.toHaveProperty("label");
  });
});

describe("log mode (the default)", () => {
  it("still serves strangers, logging once per route and space per minute", async () => {
    config.spaceReadGate = "log";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seed("gate-private", false);
    for (let i = 0; i < 3; i++) {
      const res = await server.inject({ method: "GET", url: "/spaces/gate-private/members" });
      expect(res.statusCode).toBe(200);
    }
    const gateLines = warn.mock.calls.filter((c) => String(c[0]).includes("[space-read-gate]"));
    expect(gateLines).toHaveLength(1);
    const row = await server.inject({ method: "GET", url: "/spaces/gate-private" });
    expect(row.json().data.creatorPubkey).toBe(LUNA.pubkey);
  });

  it("keeps the full invite preview for older clients", async () => {
    config.spaceReadGate = "log";
    await seed("gate-private", false);
    await db.insert(invites).values({ code: "gateinv2", spaceId: "gate-private", createdBy: LUNA.pubkey });
    const res = await server.inject({ method: "GET", url: "/invites/gateinv2" });
    expect(res.json().data.createdBy).toBe(LUNA.pubkey);
  });
});

describe("GET /permissions/check", () => {
  const check = (caller: string, pubkey: string) =>
    server.inject({
      method: "GET",
      url: `/permissions/check?spaceId=gate-private&permission=SEND_MESSAGES&pubkey=${pubkey}`,
      headers: as(caller),
    });

  it("lets anyone check themselves but only member managers check others", async () => {
    await seed("gate-private", false);
    expect((await check(MARCUS.pubkey, MARCUS.pubkey)).statusCode).toBe(200);
    const other = await check(JAYDEE.pubkey, LUNA.pubkey);
    expect(other.statusCode).toBe(403);
    expect((await check(LUNA.pubkey, MARCUS.pubkey)).statusCode).toBe(200);
  });
});
