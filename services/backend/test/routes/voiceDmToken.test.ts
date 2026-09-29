/**
 * /voice/dm-token guards.
 *
 * The room name is derived from a secret only the two call parties hold,
 * so the only cheap misuse is minting a token for a "call with yourself"
 * (room maxParticipants is 2 — a self-join would block the real partner).
 *
 * E2EE gate (docs/E2EE_CALLS.md): rooms are frame-encrypted, no plaintext
 * mode. A client that does not promise `supportsE2EE: true` gets 409 —
 * an outdated build in the room would hear noise and be heard by nobody.
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

  it("refuses a client that does not advertise E2EE support (409 E2EE_REQUIRED)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/dm-token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { partnerPubkey: MARCUS.pubkey, roomId: "r".repeat(64) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("E2EE_REQUIRED");
  });

  it("refuses supportsE2EE: false the same way", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/dm-token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { partnerPubkey: MARCUS.pubkey, roomId: "r".repeat(64), supportsE2EE: false },
    });
    expect(res.statusCode).toBe(409);
  });

  it("mints a token (with screen-share audio) for a client that supports E2EE", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/dm-token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { partnerPubkey: MARCUS.pubkey, roomId: "r".repeat(64), supportsE2EE: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data as { token: string; roomName: string; url: string };
    expect(body.roomName).toBe(`dm:${"r".repeat(64)}`);
    // The JWT payload is base64url JSON; the grant must carry the identity
    // and the DM sources incl. screen_share_audio (Windows shares system audio).
    const payload = JSON.parse(Buffer.from(body.token.split(".")[1], "base64url").toString("utf8"));
    expect(payload.sub).toBe(LUNA.pubkey);
    expect(payload.video.room).toBe(body.roomName);
    expect(payload.video.canPublishSources).toEqual(
      expect.arrayContaining(["microphone", "camera", "screen_share", "screen_share_audio"]),
    );
  });

  it("binds the room to the first two parties; a third pubkey is refused (403)", async () => {
    const roomId = "b".repeat(64);
    const mint = (who: string, partner: string) =>
      server.inject({
        method: "POST",
        url: "/voice/dm-token",
        headers: { "x-auth-pubkey": who },
        payload: { partnerPubkey: partner, roomId, supportsE2EE: true },
      });
    // Caller mints first, then the callee — both parties of the same pair.
    expect((await mint(LUNA.pubkey, MARCUS.pubkey)).statusCode).toBe(200);
    expect((await mint(MARCUS.pubkey, LUNA.pubkey)).statusCode).toBe(200);
    // Re-minting (reconnect) by a party still works.
    expect((await mint(LUNA.pubkey, MARCUS.pubkey)).statusCode).toBe(200);
    // Anyone else who learned the roomId is not a party.
    const third = "c".repeat(64);
    const res = await mint(third, LUNA.pubkey);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
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
