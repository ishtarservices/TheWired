import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA, MARCUS } from "../helpers/testUsers.js";

let server: FastifyInstance;
const SPACE_ID = "channel-test-space";

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

/** Creates a fresh space with LUNA as admin. Call at start of each test
 *  since global beforeEach truncates all tables. */
async function seedSpace(id = SPACE_ID) {
  await server.inject({
    method: "POST",
    url: "/spaces",
    headers: { "x-auth-pubkey": LUNA.pubkey },
    payload: { id, name: "Channel Test Space", hostRelay: "wss://relay.test.com", mode: "read-write" },
  });
}

describe("channels routes", () => {
  // ─── GET /:spaceId/channels ───────────────────────

  describe("GET /:spaceId/channels", () => {
    it("returns seeded channels for a new space", async () => {
      await seedSpace();
      const response = await server.inject({
        method: "GET",
        url: `/spaces/${SPACE_ID}/channels`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
    });

    it("all channels have feedMode defaulting to 'all'", async () => {
      await seedSpace();
      const response = await server.inject({
        method: "GET",
        url: `/spaces/${SPACE_ID}/channels`,
      });
      const body = response.json();
      for (const ch of body.data) {
        expect(ch.feedMode).toBe("all");
      }
    });
  });

  // ─── POST: Create channel ────────────────────────

  describe("POST /:spaceId/channels", () => {
    it("returns 401 without auth", async () => {
      await seedSpace();
      const response = await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        payload: { type: "music", label: "#second-music" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("creates a second music channel (uniqueness removed)", async () => {
      await seedSpace();
      const response = await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label: "#originals" },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.type).toBe("music");
      expect(body.data.label).toBe("#originals");
      expect(body.data.feedMode).toBe("all");
    });

    it("creates a curated music channel", async () => {
      await seedSpace();
      const response = await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label: "#covers", feedMode: "curated" },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.type).toBe("music");
      expect(body.data.label).toBe("#covers");
      expect(body.data.feedMode).toBe("curated");
    });

    it("rejects invalid feedMode value", async () => {
      await seedSpace();
      const response = await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label: "#bad", feedMode: "invalid" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("still enforces uniqueness for notes/media/articles", async () => {
      await seedSpace();
      // Notes already exists from seed — creating a second should fail
      const response = await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "notes", label: "#extra-notes" },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("Only one notes channel");
    });

    it("allows multiple music channels with same feedMode", async () => {
      await seedSpace();
      // Create first extra music
      await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label: "#curated-1", feedMode: "curated" },
      });
      // Create second extra music with same feedMode
      const response = await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label: "#curated-2", feedMode: "curated" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.feedMode).toBe("curated");
    });
  });

  // ─── PATCH: Update channel feedMode ──────────────

  describe("PATCH /:spaceId/channels/:channelId", () => {
    async function createMusicChannel(label: string, feedMode = "all") {
      await seedSpace();
      const res = await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label, feedMode },
      });
      return res.json().data.id as string;
    }

    it("toggles feedMode from all to curated", async () => {
      const channelId = await createMusicChannel("#toggle-test");
      const response = await server.inject({
        method: "PATCH",
        url: `/spaces/${SPACE_ID}/channels/${channelId}`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { feedMode: "curated" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.feedMode).toBe("curated");
    });

    it("toggles feedMode from curated back to all", async () => {
      const channelId = await createMusicChannel("#roundtrip", "curated");
      const response = await server.inject({
        method: "PATCH",
        url: `/spaces/${SPACE_ID}/channels/${channelId}`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { feedMode: "all" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.feedMode).toBe("all");
    });

    it("rejects invalid feedMode value on update", async () => {
      const channelId = await createMusicChannel("#invalid-update");
      const response = await server.inject({
        method: "PATCH",
        url: `/spaces/${SPACE_ID}/channels/${channelId}`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { feedMode: "garbage" },
      });
      expect(response.statusCode).toBe(400);
    });

    it("can update label and feedMode simultaneously", async () => {
      const channelId = await createMusicChannel("#multi-update");
      const response = await server.inject({
        method: "PATCH",
        url: `/spaces/${SPACE_ID}/channels/${channelId}`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { label: "#renamed", feedMode: "curated" },
      });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.label).toBe("#renamed");
      expect(data.feedMode).toBe("curated");
    });

    it("returns 403 for non-admin user", async () => {
      const channelId = await createMusicChannel("#no-perms");
      const response = await server.inject({
        method: "PATCH",
        url: `/spaces/${SPACE_ID}/channels/${channelId}`,
        headers: { "x-auth-pubkey": MARCUS.pubkey },
        payload: { feedMode: "curated" },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  // ─── Listing after mutations ─────────────────────

  describe("channel listing reflects feedMode", () => {
    it("GET returns multiple music channels with their feedModes", async () => {
      await seedSpace();
      // Create two extra music channels
      await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label: "#originals", feedMode: "curated" },
      });
      await server.inject({
        method: "POST",
        url: `/spaces/${SPACE_ID}/channels`,
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { type: "music", label: "#covers", feedMode: "all" },
      });

      const response = await server.inject({
        method: "GET",
        url: `/spaces/${SPACE_ID}/channels`,
      });
      const body = response.json();
      const musicChannels = body.data.filter((c: any) => c.type === "music");

      // Default seed + 2 extras = at least 3
      expect(musicChannels.length).toBeGreaterThanOrEqual(3);

      // Each should have a valid feedMode
      for (const ch of musicChannels) {
        expect(["all", "curated"]).toContain(ch.feedMode);
      }

      // Check that we have both modes represented
      const modes = new Set(musicChannels.map((c: any) => c.feedMode));
      expect(modes.has("all")).toBe(true);
      expect(modes.has("curated")).toBe(true);
    });
  });
});
