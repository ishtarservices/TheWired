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

describe("profiles routes", () => {
  describe("GET /profiles/:pubkey", () => {
    it("returns 404 for uncached profile", async () => {
      const response = await server.inject({
        method: "GET",
        url: `/profiles/${LUNA.pubkey}`,
      });
      // Should be 404 since no profiles are cached
      expect(response.statusCode).toBe(404);
    });
  });

  describe("POST /profiles/batch", () => {
    it("returns profiles for batch request", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/profiles/batch",
        payload: { pubkeys: [LUNA.pubkey] },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("data");
    });
  });
});
