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

describe("health routes", () => {
  describe("GET /health", () => {
    it("returns 200 with ok status", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/health",
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("ok");
    });
  });
});
