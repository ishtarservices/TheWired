import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA } from "../helpers/testUsers.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});

const SECRET = Buffer.alloc(32, 9).toString("base64");

function provision(headers: Record<string, string>, payload: unknown) {
  return server.inject({ method: "POST", url: "/relays/tunnel/provision", headers, payload });
}

/**
 * Route wiring for named-tunnel provisioning (Decentralized Spaces, M7). The
 * test env has no Cloudflare credentials, so the configured-guard path is what
 * we assert here (alongside auth + validation). The actual Cloudflare API calls
 * are covered structurally by the service unit test.
 */
describe("relay tunnel provisioning route (M7)", () => {
  it("requires auth", async () => {
    const r = await provision({}, { tunnelSecret: SECRET });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe("UNAUTHORIZED");
  });

  it("validates the request body", async () => {
    const r = await provision({ "x-auth-pubkey": LUNA.pubkey }, {});
    expect(r.statusCode).toBe(400);
  });

  it("returns 503 TUNNEL_NOT_CONFIGURED when Cloudflare isn't set up", async () => {
    const r = await provision({ "x-auth-pubkey": LUNA.pubkey }, { tunnelSecret: SECRET });
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe("TUNNEL_NOT_CONFIGURED");
  });

  it("rejects a non-hex relayPubkey", async () => {
    const r = await provision(
      { "x-auth-pubkey": LUNA.pubkey },
      { tunnelSecret: SECRET, relayPubkey: "not-hex" },
    );
    expect(r.statusCode).toBe(400);
  });
});
