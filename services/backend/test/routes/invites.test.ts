import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildTestServer();
});

afterAll(async () => {
  await closeTestServer();
});

describe("invites routes", () => {
  describe("POST /invites", () => {
    it("returns 401 without auth", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/invites",
        payload: { spaceId: "space-1" },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /invites/:code", () => {
    it("returns 404 for nonexistent invite code", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/invites/nonexistent-code",
      });
      expect([404, 410]).toContain(response.statusCode);
    });
  });

  describe("POST /invites/:code/redeem", () => {
    it("returns 401 without auth", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/invites/some-code/redeem",
      });
      expect(response.statusCode).toBe(401);
    });
  });
});
