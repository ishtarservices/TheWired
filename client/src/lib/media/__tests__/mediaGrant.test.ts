import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearMediaGrant,
  currentGrantExp,
  ensureMediaGrant,
  forceRefreshMediaGrant,
  getMediaGrant,
  grantNeedsRefresh,
  peekMediaGrant,
} from "../mediaGrant";
import { musicTokenCache } from "@/lib/cache/tokenCache";
import { performCleanup } from "@/lib/nostr/loginFlow";

vi.mock("@/lib/api/nip98", () => ({
  buildNip98Header: vi.fn(async () => "Nostr test"),
  buildAuthHeaders: vi.fn(async () => ({ Authorization: "Nostr test", "X-Wired-Client": "desktop/0.0.0-test (macos)" })),
}));

const WEEK = 604_800;

let mints: number;
let nextExp: () => number;
let gate: Promise<void> | null;

beforeEach(() => {
  clearMediaGrant();
  mints = 0;
  nextExp = () => currentGrantExp();
  gate = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("http://localhost:9080/api/media-grant");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Nostr test");
      if (gate) await gate;
      mints++;
      return new Response(JSON.stringify({ token: `tok-${mints}`, exp: nextExp() }), { status: 200 });
    }),
  );
});

afterEach(() => {
  clearMediaGrant();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("grant expiry math (contract §4)", () => {
  it("exp is the end of next week", () => {
    expect(currentGrantExp(0)).toBe(2 * WEEK);
    expect(currentGrantExp(WEEK - 1)).toBe(2 * WEEK);
    expect(currentGrantExp(WEEK)).toBe(3 * WEEK);
    expect(currentGrantExp(10 * WEEK + 5)).toBe(12 * WEEK);
  });

  it("a grant is refreshed once its week has passed, not before", () => {
    const now = 10 * WEEK + 100;
    expect(grantNeedsRefresh(currentGrantExp(now), now)).toBe(false);
    expect(grantNeedsRefresh(currentGrantExp(now), now + WEEK - 200)).toBe(false);
    expect(grantNeedsRefresh(currentGrantExp(now), 11 * WEEK)).toBe(true);
    expect(grantNeedsRefresh(currentGrantExp(now - WEEK), now)).toBe(true);
  });
});

describe("mediaGrant", () => {
  it("dedupes concurrent mints and serves the token synchronously afterwards", async () => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    expect(getMediaGrant()).toBeNull(); // starts a background mint
    const a = ensureMediaGrant();
    const b = ensureMediaGrant();
    release();
    expect(await a).toBe("tok-1");
    expect(await b).toBe("tok-1");
    expect(mints).toBe(1);
    expect(getMediaGrant()).toBe("tok-1");
    expect(mints).toBe(1);
  });

  it("re-mints a grant from an earlier week", async () => {
    nextExp = () => currentGrantExp() - WEEK; // what the server issued last week
    await ensureMediaGrant();
    nextExp = () => currentGrantExp();
    // Still unexpired, so it's served while the re-mint runs.
    expect(getMediaGrant()).toBe("tok-1");
    await vi.waitFor(() => expect(peekMediaGrant()).toBe("tok-2"));
    expect(mints).toBe(2);
  });

  it("forceRefresh re-mints, but at most once per window", async () => {
    await ensureMediaGrant();
    expect(await forceRefreshMediaGrant()).toBe("tok-1"); // just minted: rate limited
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 60_000);
    expect(await forceRefreshMediaGrant()).toBe("tok-2");
    expect(mints).toBe(2);
  });

  it("clear drops the grant and discards a mint still in flight", async () => {
    let release!: () => void;
    gate = new Promise((r) => (release = r));
    const pending = ensureMediaGrant();
    clearMediaGrant();
    release();
    expect(await pending).toBeNull();
    expect(peekMediaGrant()).toBeNull();
  });

  it("a failed mint backs off instead of retrying on every render", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    expect(await ensureMediaGrant()).toBeNull();
    getMediaGrant();
    getMediaGrant();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});

describe("account switch", () => {
  it("performCleanup clears the media grant and the music track grants", async () => {
    await ensureMediaGrant();
    musicTokenCache.set("31683:pk:track", { gated: false });
    expect(peekMediaGrant()).toBe("tok-1");
    expect(musicTokenCache.get("31683:pk:track")).toBeDefined();

    performCleanup();

    expect(peekMediaGrant()).toBeNull();
    expect(musicTokenCache.get("31683:pk:track")).toBeUndefined();
  });
});
