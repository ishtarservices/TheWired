import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestServer, closeTestServer } from "../helpers/testServer.js";
import { getMeilisearchClient } from "../../src/lib/meilisearch.js";
import { getRedis } from "../../src/lib/redis.js";

/**
 * `GET /health` is the container healthcheck. It must report a dead
 * dependency as a 503 (the search engine once crash-looped unnoticed behind an
 * always-ok answer), and it must answer within the healthcheck's 5 s budget
 * even when a dependency hangs instead of failing.
 */

let server: FastifyInstance;
let health: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  server = await buildTestServer();
  health = getMeilisearchClient().health as never;
});

afterAll(async () => {
  await closeTestServer();
});

afterEach(() => {
  health.mockReset();
  health.mockResolvedValue({ status: "available" });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function getHealth() {
  return server.inject({ method: "GET", url: "/health" });
}

describe("GET /health", () => {
  it("is ok with every dependency up", async () => {
    const res = await getHealth();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "ok",
      service: "backend",
      checks: { postgres: "ok", redis: "ok", meilisearch: "ok" },
    });
  });

  it("is a 503 naming Meilisearch when the engine is unreachable", async () => {
    health.mockRejectedValue(new Error("getaddrinfo ENOTFOUND meilisearch"));
    const res = await getHealth();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: "degraded",
      checks: { postgres: "ok", redis: "ok", meilisearch: "down" },
    });
  });

  it("is a 503 naming Redis when Redis fails", async () => {
    vi.spyOn(getRedis(), "ping").mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await getHealth();
    expect(res.statusCode).toBe(503);
    expect(res.json().checks).toEqual({ postgres: "ok", redis: "down", meilisearch: "ok" });
  });

  it("times a hanging dependency out instead of hanging the healthcheck", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    health.mockReturnValue(new Promise(() => {}));
    const pending = getHealth();
    await vi.advanceTimersByTimeAsync(2000);
    const res = await pending;
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.meilisearch).toBe("down");
  });
});
