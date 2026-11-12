/**
 * /voice/kick and /voice/mute: holding MUTE_MEMBERS is not enough — the actor
 * must outrank the target (permissionService.checkHierarchy), exactly like the
 * text-moderation routes; a moderator could otherwise kick the creator out of
 * every voice room on repeat. Channel tokens live one hour, like DM tokens.
 * livekitService is mocked (no LiveKit in the test env).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const lk = vi.hoisted(() => ({
  removeParticipant: vi.fn(async () => ({})),
  listParticipants: vi.fn(async (_room: string) => [{ identity: "", tracks: [{ source: "microphone", sid: "TR_mic" }] }]),
  muteParticipant: vi.fn(async () => ({})),
  generateToken: vi.fn(async (..._args: unknown[]) => "mock.jwt"),
  createRoom: vi.fn(async () => ({})),
}));
vi.mock("../../src/services/livekitService.js", () => ({
  livekitService: { ...lk, getClientUrl: () => "wss://livekit.test" },
}));

import type { FastifyInstance } from "fastify";
import { TrackSource } from "@livekit/protocol";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS, DECKARD, JAYDEE } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaceMembers } from "../../src/db/schema/members.js";
import { roleService } from "../../src/services/roleService.js";

let server: FastifyInstance;
const SPACE = "voice-mod-space";
let channelId = "";

beforeAll(async () => {
  server = await buildTestServer();
});
afterAll(async () => {
  await closeTestServer();
});

/** The harness truncates app.* before each test: rebuild the space. LUNA is
 *  the creator; MARCUS a plain member; DECKARD a moderator (MUTE_MEMBERS). */
beforeEach(async () => {
  for (const fn of Object.values(lk)) fn.mockClear();
  const create = await server.inject({
    method: "POST",
    url: "/spaces",
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload: { id: SPACE, name: "Voice", hostRelay: "wss://relay.example.com" },
  });
  expect(create.statusCode).toBe(200);
  for (const u of [MARCUS, DECKARD]) {
    await db.insert(spaceMembers).values({ spaceId: SPACE, pubkey: u.pubkey }).onConflictDoNothing();
  }
  const mod = await roleService.createRole(SPACE, { name: "Mod", permissions: ["MUTE_MEMBERS"] });
  await roleService.assignRole(SPACE, DECKARD.pubkey, mod.id);
  const ch = await server.inject({
    method: "POST",
    url: `/spaces/${SPACE}/channels`,
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload: { type: "voice", label: "Lounge" },
  });
  expect(ch.statusCode).toBe(200);
  channelId = ch.json().data.id;
  // The room service reports `source` as LiveKit's numeric enum (CAMERA = 1,
  // MICROPHONE = 2), never the client's lowercase name.
  lk.listParticipants.mockImplementation(async () => [
    { identity: LUNA.pubkey, tracks: [{ source: TrackSource.MICROPHONE, sid: "TR_luna" }] },
    {
      identity: MARCUS.pubkey,
      tracks: [{ source: TrackSource.CAMERA, sid: "TR_marcus_cam" }, { source: TrackSource.MICROPHONE, sid: "TR_marcus" }],
    },
    { identity: DECKARD.pubkey, tracks: [{ source: TrackSource.MICROPHONE, sid: "TR_deckard" }] },
  ]);
});

const kick = (actor: string, targetPubkey: string) =>
  server.inject({ method: "POST", url: "/voice/kick", headers: { "x-auth-pubkey": actor }, payload: { spaceId: SPACE, channelId, targetPubkey } });
const mute = (actor: string, targetPubkey: string) =>
  server.inject({
    method: "POST",
    url: "/voice/mute",
    headers: { "x-auth-pubkey": actor },
    payload: { spaceId: SPACE, channelId, targetPubkey, trackSource: "microphone" },
  });

describe("POST /voice/kick", () => {
  it("a moderator cannot kick the creator, an equal, or themselves", async () => {
    for (const target of [LUNA.pubkey, DECKARD.pubkey]) {
      const res = await kick(DECKARD.pubkey, target);
      expect(res.statusCode, target).toBe(403);
    }
    expect(lk.removeParticipant).not.toHaveBeenCalled();
  });

  it("a moderator kicks a plain member; the creator kicks the moderator (regression)", async () => {
    expect((await kick(DECKARD.pubkey, MARCUS.pubkey)).statusCode).toBe(200);
    expect(lk.removeParticipant).toHaveBeenCalledWith(`${SPACE}:${channelId}`, MARCUS.pubkey);
    expect((await kick(LUNA.pubkey, DECKARD.pubkey)).statusCode).toBe(200);
  });

  it("no MUTE_MEMBERS, no kick (regression)", async () => {
    expect((await kick(MARCUS.pubkey, DECKARD.pubkey)).statusCode).toBe(403);
    expect((await kick(JAYDEE.pubkey, MARCUS.pubkey)).statusCode).toBe(403);
    expect(lk.removeParticipant).not.toHaveBeenCalled();
  });
});

describe("POST /voice/mute", () => {
  it("a moderator cannot mute the creator or themselves; LiveKit is not consulted", async () => {
    expect((await mute(DECKARD.pubkey, LUNA.pubkey)).statusCode).toBe(403);
    expect((await mute(DECKARD.pubkey, DECKARD.pubkey)).statusCode).toBe(403);
    expect(lk.muteParticipant).not.toHaveBeenCalled();
    expect(lk.listParticipants).not.toHaveBeenCalled();
  });

  it("a moderator mutes a plain member (regression)", async () => {
    expect((await mute(DECKARD.pubkey, MARCUS.pubkey)).statusCode).toBe(200);
    expect(lk.muteParticipant).toHaveBeenCalledWith(`${SPACE}:${channelId}`, MARCUS.pubkey, "TR_marcus", true);
  });
});

describe("token lifetimes", () => {
  it("a channel token is minted for one hour", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { spaceId: SPACE, channelId, supportsE2EE: true },
    });
    expect(res.statusCode).toBe(200);
    expect(lk.generateToken).toHaveBeenCalledTimes(1);
    expect(lk.generateToken.mock.calls[0][4]).toBe(3600);
  });

  it("a DM token is minted for one hour (regression)", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/voice/dm-token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { partnerPubkey: MARCUS.pubkey, roomId: "r".repeat(64), supportsE2EE: true },
    });
    expect(res.statusCode).toBe(200);
    expect(lk.generateToken.mock.calls[0][4]).toBe(3600);
  });
});
