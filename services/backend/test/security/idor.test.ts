/**
 * PROBE #14 / #15 — cross-space channel/role IDOR.
 *
 * pre-fix (unpatched): an admin of space B can PATCH/DELETE space A's channels and
 *   roles (and rewrite A's role permissions / channel overrides) by passing A's
 *   child-row id under B's URL — the services scope by child id only, so B's
 *   MANAGE_* permission authorizes the foreign mutation.
 * post-fix asserts: every cross-space mutation 404s and A's rows are untouched;
 *   the previously-unauthenticated GET overrides route now requires MANAGE_ROLES.
 *
 * Each `it` builds both spaces inline (harness TRUNCATEs app.* between tests).
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

async function firstChannelId(spaceId: string): Promise<string> {
  const res = await server.inject({ method: "GET", url: `/spaces/${spaceId}/channels` });
  return res.json().data[0].id;
}

async function nonAdminRoleId(spaceId: string): Promise<string> {
  // the default Member role (isDefault, not admin) — deletable target
  const res = await server.inject({ method: "GET", url: `/spaces/${spaceId}/roles` });
  const member = res.json().data.find((r: any) => r.isDefault) ?? res.json().data.find((r: any) => !r.isAdmin);
  return member.id;
}

beforeAll(async () => { server = await buildTestServer(); });
afterAll(async () => { await closeTestServer(); });

describe("PROBE #14/#15 — cross-space IDOR", () => {
  it("blocks editing another space's channel from your own space context (#14)", async () => {
    await createSpace("idor-A", LUNA.pubkey);
    await createSpace("idor-B", MARCUS.pubkey);
    const aChannel = await firstChannelId("idor-A");

    const res = await server.inject({
      method: "PATCH",
      url: `/spaces/idor-B/channels/${aChannel}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { label: "#hijacked" },
    });
    expect(res.statusCode).toBe(404);

    const aChannels = await server.inject({ method: "GET", url: "/spaces/idor-A/channels" });
    const ch = aChannels.json().data.find((c: any) => c.id === aChannel);
    expect(ch.label).not.toBe("#hijacked");
  });

  it("blocks deleting another space's channel (#14)", async () => {
    await createSpace("idor-A", LUNA.pubkey);
    await createSpace("idor-B", MARCUS.pubkey);
    const aChannel = await firstChannelId("idor-A");

    const res = await server.inject({
      method: "DELETE",
      url: `/spaces/idor-B/channels/${aChannel}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(res.statusCode).toBe(404);

    const aChannels = await server.inject({ method: "GET", url: "/spaces/idor-A/channels" });
    expect(aChannels.json().data.some((c: any) => c.id === aChannel)).toBe(true);
  });

  it("blocks deleting another space's role (#15)", async () => {
    await createSpace("idor-A", LUNA.pubkey);
    await createSpace("idor-B", MARCUS.pubkey);
    const aRole = await nonAdminRoleId("idor-A");

    const res = await server.inject({
      method: "DELETE",
      url: `/spaces/idor-B/roles/${aRole}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(res.statusCode).toBe(404);

    const aRoles = await server.inject({ method: "GET", url: "/spaces/idor-A/roles" });
    expect(aRoles.json().data.some((r: any) => r.id === aRole)).toBe(true);
  });

  it("blocks rewriting another space's role permissions (#15)", async () => {
    await createSpace("idor-A", LUNA.pubkey);
    await createSpace("idor-B", MARCUS.pubkey);
    const aRole = await nonAdminRoleId("idor-A");

    const res = await server.inject({
      method: "PATCH",
      url: `/spaces/idor-B/roles/${aRole}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { permissions: ["MANAGE_SPACE", "BAN_MEMBERS"] },
    });
    expect(res.statusCode).toBe(404);

    // A's role permissions unchanged (still the default Member set, no MANAGE_SPACE)
    const aRoles = await server.inject({ method: "GET", url: "/spaces/idor-A/roles" });
    const role = aRoles.json().data.find((r: any) => r.id === aRole);
    expect(role.permissions).not.toContain("MANAGE_SPACE");
  });

  it("blocks setting channel overrides on another space's role (#15)", async () => {
    await createSpace("idor-A", LUNA.pubkey);
    await createSpace("idor-B", MARCUS.pubkey);
    const aRole = await nonAdminRoleId("idor-A");

    const res = await server.inject({
      method: "PUT",
      url: `/spaces/idor-B/roles/${aRole}/overrides`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { overrides: [{ channelId: "x", allow: [], deny: ["SEND_MESSAGES"] }] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires MANAGE_ROLES to read a role's overrides (previously unauthenticated)", async () => {
    await createSpace("idor-A", LUNA.pubkey);
    const aRole = await nonAdminRoleId("idor-A");

    // anonymous → 401
    const anon = await server.inject({ method: "GET", url: `/spaces/idor-A/roles/${aRole}/overrides` });
    expect(anon.statusCode).toBe(401);

    // non-member → 403
    const outsider = await server.inject({
      method: "GET",
      url: `/spaces/idor-A/roles/${aRole}/overrides`,
      headers: { "x-auth-pubkey": JAYDEE.pubkey },
    });
    expect(outsider.statusCode).toBe(403);

    // creator → 200
    const admin = await server.inject({
      method: "GET",
      url: `/spaces/idor-A/roles/${aRole}/overrides`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(admin.statusCode).toBe(200);
  });
});
