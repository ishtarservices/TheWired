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
