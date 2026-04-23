import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { setApiBaseUrl } from "../client";
import { getAudioVariants } from "../music";

vi.mock("../nip98", () => ({
  buildNip98Header: vi.fn().mockResolvedValue("Nostr dGVzdA=="),
}));

const BASE = "http://test-api.local";
const VALID_SHA = "a".repeat(64);

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

describe("getAudioVariants", () => {
  it("returns the parsed body when the backend reports ready", async () => {
    server.use(
      http.get(`${BASE}/music/variants/${VALID_SHA}`, () =>
        HttpResponse.json({
          data: {
            status: "ready",
            hlsMaster: "https://api.example/hls/abc/master.m3u8",
            loudnessI: -14.1,
          },
        }),
      ),
    );

    const result = await getAudioVariants(VALID_SHA);
    expect(result).toEqual({
      status: "ready",
      hlsMaster: "https://api.example/hls/abc/master.m3u8",
      loudnessI: -14.1,
    });
  });

  it("returns the pending status without an hlsMaster", async () => {
    server.use(
      http.get(`${BASE}/music/variants/${VALID_SHA}`, () =>
        HttpResponse.json({ data: { status: "pending" } }),
      ),
    );

    const result = await getAudioVariants(VALID_SHA);
    expect(result).toEqual({ status: "pending" });
  });

  it("returns null on a 500 without throwing (player falls back)", async () => {
    server.use(
      http.get(`${BASE}/music/variants/${VALID_SHA}`, () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );

    const result = await getAudioVariants(VALID_SHA);
    expect(result).toBeNull();
  });

  it("returns null on a network error without throwing", async () => {
    server.use(
      http.get(`${BASE}/music/variants/${VALID_SHA}`, () => HttpResponse.error()),
    );

    const result = await getAudioVariants(VALID_SHA);
    expect(result).toBeNull();
  });

  it("rejects invalid sha256 input without even hitting the network", async () => {
    // If the client tried to fetch, MSW would throw "onUnhandledRequest: error".
    // The guard short-circuits → null.
    expect(await getAudioVariants("not-a-sha")).toBeNull();
    expect(await getAudioVariants("")).toBeNull();
    expect(await getAudioVariants("A".repeat(64))).toBeNull(); // uppercase — regex requires lowercase
  });
});
