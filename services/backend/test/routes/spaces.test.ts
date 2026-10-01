import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { LUNA } from "../helpers/testUsers.js";
import { db } from "../../src/db/connection.js";
import { spaces } from "../../src/db/schema/spaces.js";
import { config } from "../../src/config.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

describe("spaces routes", () => {
  describe("GET /spaces", () => {
    it("returns a list of spaces", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/spaces",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe("POST /spaces", () => {
    it("returns 401 without auth", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/spaces",
        payload: { id: "test-space", name: "Test", hostRelay: "wss://r.com" },
      });
      expect(response.statusCode).toBe(401);
    });

    it("creates a space with auth", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/spaces",
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: {
          id: "space-create-test",
          name: "Created Space",
          hostRelay: "wss://relay.test.com",
          mode: "read-write",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.id).toBe("space-create-test");
    });
    it("rejects a hostRelay that is not wss:// on a public host", async () => {
      for (const hostRelay of [
        "ws://relay.example.com",
        "wss://192.168.1.20:7787",
        "wss://localhost:7777",
        "wss://100.64.0.9",
        "wss://[fd00::7]",
        "wss://[::ffff:127.0.0.1]",
      ]) {
        const response = await server.inject({
          method: "POST",
          url: "/spaces",
          headers: { "x-auth-pubkey": LUNA.pubkey },
          payload: { id: "space-bad-host", name: "Bad host", hostRelay },
        });
        expect(response.statusCode, hostRelay).toBe(400);
        expect(response.json().code).toBe("INVALID_HOST_RELAY");
      }
    });

    it("never exempts the internal relay address", async () => {
      const saved = config.relayUrl;
      (config as { relayUrl: string }).relayUrl = "ws://relay:7777";
      try {
        const response = await server.inject({
          method: "POST",
          url: "/spaces",
          headers: { "x-auth-pubkey": LUNA.pubkey },
          payload: { id: "space-internal-relay", name: "Internal", hostRelay: "ws://relay:7777" },
        });
        expect(response.statusCode).toBe(400);
      } finally {
        (config as { relayUrl: string }).relayUrl = saved;
      }
    });

    it("accepts the platform relay itself as hostRelay (ws://localhost in dev)", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/spaces",
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { id: "space-own-relay", name: "Own relay", hostRelay: config.publicRelayUrl },
      });
      expect(response.statusCode).toBe(200);
    });

    it("does not re-validate hostRelay when the creator re-registers (cache recovery)", async () => {
      await db.insert(spaces).values({
        id: "space-legacy-host",
        name: "Legacy",
        hostRelay: "ws://10.0.0.5:7777",
        creatorPubkey: LUNA.pubkey,
        createdAt: Date.now(),
      });
      const response = await server.inject({
        method: "POST",
        url: "/spaces",
        headers: { "x-auth-pubkey": LUNA.pubkey },
        payload: { id: "space-legacy-host", name: "Legacy renamed", hostRelay: "ws://10.0.0.5:7777" },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("GET /spaces/:id", () => {
    it("returns 404 for nonexistent space", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/spaces/nonexistent-id",
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("GET /spaces/my-spaces", () => {
    it("returns 401 without auth", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/spaces/my-spaces",
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns user's spaces with auth", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/spaces/my-spaces",
        headers: { "x-auth-pubkey": LUNA.pubkey },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("data");
    });
  });
});
