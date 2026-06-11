/**
 * PROBE #75 — voice token over-grant.
 *
 * pre-fix: every voice token hardcodes canPublish:true + all four publish sources
 *   and gates only on a non-existent "JOIN_VOICE" permission, so a listen-only /
 *   channel-denied member can still publish mic/cam/screen.
 * post-fix asserts: publish sources are computed from effective CONNECT/SPEAK/
 *   VIDEO/SCREEN_SHARE permissions; a listen-only member gets no sources; a
 *   VIDEO-denied member gets microphone but not camera; an admin gets all.
 *
 * livekitService is mocked to capture the grant object (avoids real LiveKit env).
 * Needs Postgres `thewired_test` (pnpm dev:infra).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

const captured = vi.hoisted(() => ({ grants: null as any }));

vi.mock("../../src/services/livekitService.js", () => ({
  livekitService: {
    generateToken: vi.fn(async (_id: string, _room: string, _name: string, grants: any) => {
      captured.grants = grants;
      return "mock.jwt.token";
    }),
    createRoom: vi.fn(async () => ({})),
    getClientUrl: () => "wss://livekit.test",
  },
}));

import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaceChannels } from "../../src/db/schema/channels.js";
import { spaceRoles, rolePermissions, channelOverrides } from "../../src/db/schema/permissions.js";
import { spaceMembers, memberRoles } from "../../src/db/schema/members.js";
import { nanoid } from "../../src/lib/id.js";

let server: FastifyInstance;

async function setupVoiceSpace() {
  await server.inject({
    method: "POST", url: "/spaces",
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload: { id: "voice-space", name: "Voice", hostRelay: "wss://relay.test" },
  });
  const channelId = nanoid(12);
  await db.insert(spaceChannels).values({
    id: channelId, spaceId: "voice-space", type: "voice", label: "#vc", position: 99,
  });
  return channelId;
}

/** Give MARCUS a custom role with exactly `perms` on voice-space. */
async function giveMarcusRole(perms: string[]): Promise<string> {
  const roleId = nanoid(12);
  await db.insert(spaceRoles).values({ id: roleId, spaceId: "voice-space", name: "custom", position: 5, isDefault: false, isAdmin: false });
  if (perms.length) await db.insert(rolePermissions).values(perms.map((p) => ({ roleId, permission: p })));
  await db.insert(spaceMembers).values({ spaceId: "voice-space", pubkey: MARCUS.pubkey }).onConflictDoNothing();
  await db.insert(memberRoles).values({ spaceId: "voice-space", pubkey: MARCUS.pubkey, roleId }).onConflictDoNothing();
  return roleId;
}

beforeAll(async () => { server = await buildTestServer(); });
afterEach(() => { captured.grants = null; });

describe("PROBE #75 — voice token publish grants", () => {
  it("listen-only member (CONNECT only) gets no publish sources", async () => {
    const channelId = await setupVoiceSpace();
    await giveMarcusRole(["CONNECT"]);

    const res = await server.inject({
      method: "POST", url: "/voice/token",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { spaceId: "voice-space", channelId },
    });
    expect(res.statusCode).toBe(200);
    expect(captured.grants.canPublish).toBe(false);
    expect(captured.grants.canPublishSources).toEqual([]);
    expect(captured.grants.canSubscribe).toBe(true);
  });

  it("SPEAK granted but VIDEO denied → microphone only, no camera", async () => {
    const channelId = await setupVoiceSpace();
    const roleId = await giveMarcusRole(["CONNECT", "SPEAK", "VIDEO"]);
    // channel override: deny VIDEO on the voice channel for this role
    await db.insert(channelOverrides).values({ roleId, channelId, permission: "VIDEO", effect: "deny" });

    const res = await server.inject({
      method: "POST", url: "/voice/token",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { spaceId: "voice-space", channelId },
    });
    expect(res.statusCode).toBe(200);
    expect(captured.grants.canPublishSources).toContain("microphone");
    expect(captured.grants.canPublishSources).not.toContain("camera");
    expect(captured.grants.canPublish).toBe(true);
  });

  it("CONNECT denied → 403, no token", async () => {
    const channelId = await setupVoiceSpace();
    await giveMarcusRole([]); // member, but no CONNECT
    const res = await server.inject({
      method: "POST", url: "/voice/token",
      headers: { "x-auth-pubkey": MARCUS.pubkey },
      payload: { spaceId: "voice-space", channelId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("admin (creator) gets all four sources", async () => {
    const channelId = await setupVoiceSpace();
    const res = await server.inject({
      method: "POST", url: "/voice/token",
      headers: { "x-auth-pubkey": LUNA.pubkey },
      payload: { spaceId: "voice-space", channelId },
    });
    expect(res.statusCode).toBe(200);
    expect(captured.grants.canPublishSources).toEqual(
      expect.arrayContaining(["microphone", "camera", "screen_share", "screen_share_audio"]),
    );
  });
});
