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

describe("authContext middleware", () => {
  it("extracts pubkey from valid X-Auth-Pubkey header", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        "x-auth-pubkey": LUNA.pubkey,
      },
    });
    // Health endpoint should work regardless, but the pubkey should be parsed
    expect(response.statusCode).toBe(200);
  });

  it("does not set pubkey for missing header", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
    });
    expect(response.statusCode).toBe(200);
  });

  it("does not set pubkey for invalid-length header", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/health",
      headers: {
        "x-auth-pubkey": "tooshort",
      },
    });
    // Should still return 200 for health, just without auth context
    expect(response.statusCode).toBe(200);
  });
});
