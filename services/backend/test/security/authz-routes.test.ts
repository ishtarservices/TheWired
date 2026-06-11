/**
 * PROBE #57 / #58 / #102 — unauthenticated invite revoke, unauthenticated
 * analytics, force-list a space you don't own.
 *
 * pre-fix: DELETE /invites/:code with no auth revokes anyone's invite; GET
 *   /analytics/spaces/:id returns 30-day activity to anonymous callers; POST
 *   /discovery/listing-requests flips a victim's space to listed with
 *   attacker-chosen category/tags.
 * post-fix asserts: invite revoke needs ownership; analytics needs VIEW_ANALYTICS;
 *   listing-requests needs creator/MANAGE_SPACE.
 *
 * Harness TRUNCATEs app.* between tests → build state inline.
 * Needs Postgres `thewired_test` (pnpm dev:infra).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, JAYDEE } from "../helpers/testUsers.js";

let server: FastifyInstance;

async function createSpace(id: string, creator: string) {
  const res = await server.inject({
    method: "POST",
    url: "/spaces",
    headers: { "x-auth-pubkey": creator },
    payload: { id, name: id, hostRelay: "wss://relay.test" },
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => { server = await buildTestServer(); });
afterAll(async () => { await closeTestServer(); });

describe("PROBE #57 — invite revoke authz", () => {
  it("rejects anonymous and outsider revoke; allows the space creator", async () => {
    await createSpace("inv-space", LUNA.pubkey);
    const created = await server.inject({
      method: "POST",
      url: "/invites",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { spaceId: "inv-space" },
    });
    expect(created.statusCode).toBe(200);
    const code = created.json().data.code ?? created.json().data.invite?.code ?? created.json().data.inviteCode;
    expect(code).toBeTruthy();

    // anonymous → 401
    const anon = await server.inject({ method: "DELETE", url: `/invites/${code}` });
    expect(anon.statusCode).toBe(401);

    // outsider → 403
    const outsider = await server.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { "x-auth-pubkey": JAYDEE.pubkey },
    });
    expect(outsider.statusCode).toBe(403);

    // unknown code → 404
    const unknown = await server.inject({
      method: "DELETE",
      url: `/invites/does-not-exist`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(unknown.statusCode).toBe(404);

    // creator → 200
    const ok = await server.inject({
      method: "DELETE",
      url: `/invites/${code}`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(ok.statusCode).toBe(200);
  });
});

describe("PROBE #58 — analytics authz", () => {
  it("rejects anonymous and non-member; allows admin", async () => {
    await createSpace("an-space", LUNA.pubkey);

    const anon = await server.inject({ method: "GET", url: "/analytics/spaces/an-space" });
    expect(anon.statusCode).toBe(401);

    const outsider = await server.inject({
      method: "GET",
      url: "/analytics/spaces/an-space",
      headers: { "x-auth-pubkey": JAYDEE.pubkey },
    });
    expect(outsider.statusCode).toBe(403);

    const admin = await server.inject({
      method: "GET",
      url: "/analytics/spaces/an-space",
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(admin.statusCode).toBe(200);
  });
});

describe("PROBE #102 — force-list authz", () => {
  it("rejects a non-owner listing-request and does not list the space", async () => {
    await createSpace("ll-space", LUNA.pubkey);

    const attack = await server.inject({
      method: "POST",
      url: "/discovery/listing-requests",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { spaceId: "ll-space", category: "tech", tags: ["x"] },
    });
    expect(attack.statusCode).toBe(403);

    const space = await server.inject({ method: "GET", url: "/spaces/ll-space" });
    expect(space.json().data.listed).toBe(false);
  });
});
