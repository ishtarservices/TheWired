import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { api, ApiRequestError, setApiBaseUrl } from "../client";

// Mock the NIP-98 header builder to avoid needing a real signer
vi.mock("../nip98", () => ({
  buildNip98Header: vi.fn().mockResolvedValue("Nostr dGVzdA=="),
}));

const BASE = "http://test-api.local";

const server = setupServer();

beforeAll(() => {
  setApiBaseUrl(BASE);
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe("api client", () => {
  it("makes a successful GET request", async () => {
    server.use(
      http.get(`${BASE}/spaces`, () =>
        HttpResponse.json({ data: [{ id: "s1" }] }),
      ),
    );

    const result = await api<{ id: string }[]>("/spaces");
    expect(result.data).toEqual([{ id: "s1" }]);
  });

  it("makes a successful POST request with body", async () => {
    server.use(
      http.post(`${BASE}/spaces`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ data: { id: "s1", name: body.name } });
      }),
    );

    const result = await api("/spaces", {
      method: "POST",
      body: { name: "Test Space" },
    });
    expect(result.data).toEqual({ id: "s1", name: "Test Space" });
  });

  it("sends Authorization header when auth=true (default)", async () => {
    let authHeader: string | null = null;
    server.use(
      http.get(`${BASE}/test`, ({ request }) => {
        authHeader = request.headers.get("Authorization");
        return HttpResponse.json({ data: "ok" });
      }),
    );

    await api("/test");
    expect(authHeader).toBe("Nostr dGVzdA==");
  });

  it("skips Authorization header when auth=false", async () => {
    let authHeader: string | null = null;
    server.use(
      http.get(`${BASE}/test`, ({ request }) => {
        authHeader = request.headers.get("Authorization");
        return HttpResponse.json({ data: "ok" });
      }),
    );

    await api("/test", { auth: false });
    expect(authHeader).toBeNull();
  });

  it("does not send Content-Type for GET requests", async () => {
    let contentType: string | null = null;
    server.use(
      http.get(`${BASE}/test`, ({ request }) => {
        contentType = request.headers.get("Content-Type");
        return HttpResponse.json({ data: "ok" });
      }),
    );

    await api("/test");
    expect(contentType).toBeNull();
  });

  it("sends Content-Type: application/json for POST with body", async () => {
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/test`, ({ request }) => {
        contentType = request.headers.get("Content-Type");
        return HttpResponse.json({ data: "ok" });
      }),
    );

    await api("/test", { method: "POST", body: { key: "val" } });
    expect(contentType).toBe("application/json");
  });

  it("throws ApiRequestError on non-200 response", async () => {
    server.use(
      http.get(`${BASE}/fail`, () =>
        HttpResponse.json(
          { error: "Not Found", code: "NOT_FOUND" },
          { status: 404 },
        ),
      ),
    );

    await expect(api("/fail")).rejects.toThrow(ApiRequestError);

    try {
      await api("/fail");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).status).toBe(404);
      expect((err as ApiRequestError).code).toBe("NOT_FOUND");
    }
  });

  it("retries once on 429 via request queue", { timeout: 30_000 }, async () => {
    let callCount = 0;
    server.use(
      http.get(`${BASE}/limited`, () => {
        callCount++;
        if (callCount <= 1) {
          return HttpResponse.json(
            { error: "Rate limited", code: "RATE_LIMIT" },
            { status: 429, headers: { "Retry-After": "1" } },
          );
        }
        return HttpResponse.json({ data: "success" });
      }),
    );

    const result = await api<string>("/limited");
    expect(result.data).toBe("success");
    expect(callCount).toBe(2); // 1 failure + 1 retry success
  });

  it("throws after retry also gets 429", { timeout: 30_000 }, async () => {
    server.use(
      http.get(`${BASE}/always-limited`, () =>
        HttpResponse.json(
          { error: "Rate limited", code: "RATE_LIMIT" },
          { status: 429, headers: { "Retry-After": "1" } },
        ),
      ),
    );

    await expect(api("/always-limited")).rejects.toThrow(ApiRequestError);
  });

  it("handles non-JSON error responses gracefully", async () => {
    server.use(
      http.get(`${BASE}/server-error`, () =>
        new HttpResponse("Internal Server Error", { status: 500 }),
      ),
    );

    try {
      await api("/server-error");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).code).toBe("UNKNOWN");
    }
  });
});
