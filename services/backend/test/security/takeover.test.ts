/**
 * PROBE #0 — space takeover via POST /spaces upsert.
 *
 * pre-fix (unpatched): MARCUS POSTs a victim's space id → 200, creatorPubkey is
 *   rewritten to MARCUS, name/about overwritten, MARCUS is seeded as Admin, and
 *   MARCUS can DELETE the space. Full takeover.
 * post-fix asserts: 403 SPACE_EXISTS; creatorPubkey unchanged; metadata unchanged;
 *   MARCUS not a member/Admin; MARCUS DELETE → 403; legit creator re-registration
 *   still succeeds; /roles/seed cannot make a stranger Admin.
 *
 * NOTE: the harness TRUNCATEs app.* between every `it` (test/setup.ts beforeEach),
 * so each scenario creates its own victim space inline.
 *
 * Needs Postgres `thewired_test` (pnpm dev:infra).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

let server: FastifyInstance;

const SPACE_ID = "takeover-probe-space";

async function createVictimSpace() {
  const res = await server.inject({
    method: "POST",
    url: "/spaces",
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload: { id: SPACE_ID, name: "Luna's Space", about: "mine", hostRelay: "wss://relay.luna.test" },
  });
  expect(res.statusCode).toBe(200);
}

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

describe("PROBE #0 — space takeover via POST /spaces", () => {
  it("rejects a non-creator re-POSTing an existing space id and preserves ownership", async () => {
    await createVictimSpace();

    const attack = await server.inject({
      method: "POST",
      url: "/spaces",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { id: SPACE_ID, name: "PWNED", about: "stolen", hostRelay: "wss://relay.evil.test" },
    });
    expect(attack.statusCode).toBe(403);
    expect(attack.json().code).toBe("SPACE_EXISTS");

    const get = await server.inject({ method: "GET", url: `/spaces/${SPACE_ID}` });
    expect(get.json().data.creatorPubkey).toBe(LUNA.pubkey);
    expect(get.json().data.name).toBe("Luna's Space");
    expect(get.json().data.about).toBe("mine");
  });

  it("does not seed the attacker as a member/Admin", async () => {
    await createVictimSpace();
    await server.inject({
      method: "POST",
      url: "/spaces",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { id: SPACE_ID, name: "PWNED", hostRelay: "wss://relay.evil.test" },
    });

    const roles = await server.inject({ method: "GET", url: `/spaces/${SPACE_ID}/member-roles` });
    expect(roles.statusCode).toBe(200);
    const marcus = roles.json().data.find((m: any) => m.pubkey === MARCUS.pubkey);
    const isAdmin = marcus?.roles?.some((r: any) => r.isAdmin) ?? false;
    expect(isAdmin).toBe(false);
  });

  it("does not let the attacker DELETE the victim space", async () => {
    await createVictimSpace();
    await server.inject({
      method: "POST",
      url: "/spaces",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { id: SPACE_ID, name: "PWNED", hostRelay: "wss://relay.evil.test" },
    });

    const del = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });
    expect(del.statusCode).toBe(403);

    const get = await server.inject({ method: "GET", url: `/spaces/${SPACE_ID}` });
    expect(get.statusCode).toBe(200);
  });

  it("still lets the real creator re-register (cache-wipe recovery) without losing ownership", async () => {
    await createVictimSpace();

    const reReg = await server.inject({
      method: "POST",
      url: "/spaces",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { id: SPACE_ID, name: "Luna's Space (renamed)", about: "still mine", hostRelay: "wss://relay.luna.test" },
    });
    expect(reReg.statusCode).toBe(200);

    const get = await server.inject({ method: "GET", url: `/spaces/${SPACE_ID}` });
    expect(get.json().data.creatorPubkey).toBe(LUNA.pubkey);
    expect(get.json().data.name).toBe("Luna's Space (renamed)");
  });

  it("does not let a stranger become Admin via POST /roles/seed (sibling takeover path)", async () => {
    await createVictimSpace();

    await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/roles/seed`,
      headers: { "x-auth-pubkey": MARCUS.pubkey },
    });

    const roles = await server.inject({ method: "GET", url: `/spaces/${SPACE_ID}/member-roles` });
    const marcus = roles.json().data.find((m: any) => m.pubkey === MARCUS.pubkey);
    const isAdmin = marcus?.roles?.some((r: any) => r.isAdmin) ?? false;
    expect(isAdmin).toBe(false);
  });
});
