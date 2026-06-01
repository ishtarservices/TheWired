import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

let server: FastifyInstance;
const SPACE_ID = "relay-reg-space";

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

// app.* tables are truncated per-test (setup.ts), so re-create the space each time.
beforeEach(async () => {
  await server.inject({
    method: "POST",
    url: "/spaces",
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload: { id: SPACE_ID, name: "Reg", hostRelay: "wss://relay.test.com", mode: "read-write" },
  });
});

function register(pubkey: string, relayUrl: string) {
  return server.inject({
    method: "POST",
    url: `/spaces/${SPACE_ID}/relays`,
    headers: { "x-auth-pubkey": pubkey },
    payload: { relayUrl },
  });
}

describe("space relays routes (M3 registration)", () => {
  it("requires auth", async () => {
    const r = await server.inject({
      method: "POST",
      url: `/spaces/${SPACE_ID}/relays`,
      payload: { relayUrl: "wss://groups.0xchat.com" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("rejects SSRF / private relay URLs", async () => {
    const r = await register(LUNA.pubkey, "ws://127.0.0.1:7777");
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INVALID_RELAY_URL");
  });

  it("lets the creator register a relay (pending by default)", async () => {
    const r = await register(LUNA.pubkey, "wss://groups.0xchat.com");
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("pending");
  });

  it("forbids a non-creator from registering", async () => {
    const r = await register(MARCUS.pubkey, "wss://groups.fiatjaf.com");
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("CREATOR_ONLY");
  });

  it("404 for an unknown space", async () => {
    const r = await server.inject({
      method: "POST",
      url: `/spaces/no-such-space/relays`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { relayUrl: "wss://groups.0xchat.com" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("lists and removes a registered relay", async () => {
    await register(LUNA.pubkey, "wss://groups.0xchat.com");

    const list = await server.inject({
      method: "GET",
      url: `/spaces/${SPACE_ID}/relays`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((row: { relayUrl: string }) => row.relayUrl === "wss://groups.0xchat.com")).toBe(true);

    const del = await server.inject({
      method: "DELETE",
      url: `/spaces/${SPACE_ID}/relays`,
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { relayUrl: "wss://groups.0xchat.com" },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().data.removed).toBe(true);
  });
});
