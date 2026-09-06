/**
 * /voice/dm-token guards.
 *
 * The room name is derived from a secret only the two call parties hold,
 * so the only cheap misuse is minting a token for a "call with yourself"
 * (room maxParticipants is 2 — a self-join would block the real partner).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

describe("POST /voice/dm-token", () => {
  it("requires auth", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/dm-token",
      payload: { partnerPubkey: MARCUS.pubkey, roomId: "r".repeat(64) },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a call with yourself", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/dm-token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { partnerPubkey: LUNA.pubkey, roomId: "r".repeat(64) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("BAD_REQUEST");
  });

  it("validates the body", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/dm-token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { partnerPubkey: "not-a-pubkey", roomId: "" },
    });
    expect(res.statusCode).toBe(400);
  });
});
