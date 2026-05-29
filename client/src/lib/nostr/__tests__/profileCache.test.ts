import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { NostrEvent } from "../../../types/nostr";

// --- Mocks (hoisted before profileCache imports them) ---

vi.mock("../relayManager", () => ({
  relayManager: {
    subscribe: vi.fn(() => "sub_test"),
    closeSubscription: vi.fn(),
    getReadRelays: vi.fn(() => []),
    getAllConnections: vi.fn(() => new Map()),
    // groupSubscriptions registers a reconnect listener at module load (pulled
    // in transitively via kickHandler → spaceCleanup).
    onReconnect: vi.fn(() => () => {}),
  },
}));

vi.mock("../../db/profileStore", () => ({
  getProfile: vi.fn(async () => undefined), // IDB miss by default
  putProfile: vi.fn(async () => {}),
}));

vi.mock("../../api/profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/profiles")>();
  return { ...actual, batchProfiles: vi.fn() }; // keep real cachedProfileToKind0
});

import { profileCache } from "../profileCache";
import { relayManager } from "../relayManager";
import { batchProfiles } from "../../api/profiles";
import { getProfile } from "../../db/profileStore";

const subscribeMock = relayManager.subscribe as unknown as Mock;
const batchMock = batchProfiles as unknown as Mock;
const getProfileMock = getProfile as unknown as Mock;

const PK = {
  a: "a".repeat(64),
  b: "b".repeat(64),
  c: "c".repeat(64),
  d: "d".repeat(64),
  e: "e".repeat(64),
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A backend CachedProfile row. */
function row(pubkey: string, createdAt: number | null, name = "name-" + pubkey.slice(0, 4)) {
  return {
    pubkey,
    name,
    displayName: null,
    picture: null,
    about: null,
    nip05: null,
    banner: null,
    lud16: null,
    website: null,
    createdAt,
    fetchedAt: Date.now(),
  };
}

/** A signed-shaped kind:0 relay event. */
function kind0(pubkey: string, createdAt: number, name: string): NostrEvent {
  return {
    id: "0".repeat(64),
    pubkey,
    kind: 0,
    created_at: createdAt,
    tags: [],
    content: JSON.stringify({ name }),
    sig: "0".repeat(128),
  };
}

/** Authors targeted by the most recent relay subscribe() call, or null if none. */
function lastRelayAuthors(): string[] | null {
  if (subscribeMock.mock.calls.length === 0) return null;
  const opts = subscribeMock.mock.calls[subscribeMock.mock.calls.length - 1][0];
  return opts.filters[0].authors as string[];
}

beforeEach(() => {
  profileCache.clear();
  subscribeMock.mockClear();
  batchMock.mockReset();
  batchMock.mockResolvedValue({ data: [] }); // default: backend miss
});

describe("profileCache created_at version guard (ingest)", () => {
  it("accepts a newer kind:0 and rejects an older one (no regression)", () => {
    profileCache.handleProfileEvent(kind0(PK.a, 500, "newer"));
    expect(profileCache.getCached(PK.a)?.name).toBe("newer");

    // Older event must not overwrite.
    profileCache.handleProfileEvent(kind0(PK.a, 100, "older"));
    expect(profileCache.getCached(PK.a)?.name).toBe("newer");

    // Equal timestamp also rejected (not a downgrade).
    profileCache.handleProfileEvent(kind0(PK.a, 500, "equal"));
    expect(profileCache.getCached(PK.a)?.name).toBe("newer");

    // A strictly newer event wins.
    profileCache.handleProfileEvent(kind0(PK.a, 900, "newest"));
    expect(profileCache.getCached(PK.a)?.name).toBe("newest");
  });

  it("notifies subscribers when a newer profile arrives", () => {
    const seen: string[] = [];
    profileCache.subscribe(PK.a, (p) => seen.push(p.name ?? ""));
    profileCache.handleProfileEvent(kind0(PK.a, 100, "first"));
    profileCache.handleProfileEvent(kind0(PK.a, 50, "stale")); // rejected → no notify
    profileCache.handleProfileEvent(kind0(PK.a, 200, "second"));
    expect(seen).toEqual(["first", "second"]);
  });
});

describe("profileCache L3 (backend) → L4 (relay) routing", () => {
  it("backend hit with a real version skips the relay fetch", async () => {
    batchMock.mockResolvedValue({ data: [row(PK.a, 1234, "Alice")] });
    const seen: string[] = [];
    profileCache.subscribe(PK.a, (p) => seen.push(p.name ?? ""));

    await wait(350); // debounce + backend

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(profileCache.getCached(PK.a)?.name).toBe("Alice");
    expect(seen).toContain("Alice");
    expect(subscribeMock).not.toHaveBeenCalled(); // no relay fetch
  });

  it("backend miss falls through to a relay fetch", async () => {
    batchMock.mockResolvedValue({ data: [] });
    profileCache.subscribe(PK.b, () => {});

    await wait(350);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(lastRelayAuthors()).toContain(PK.b);
  });

  it("backend legacy row (created_at null) still paints but is relay-revalidated", async () => {
    batchMock.mockResolvedValue({ data: [row(PK.c, null, "LegacyName")] });
    const seen: string[] = [];
    profileCache.subscribe(PK.c, (p) => seen.push(p.name ?? ""));

    await wait(350);

    expect(seen).toContain("LegacyName"); // painted from backend
    expect(lastRelayAuthors()).toContain(PK.c); // but still queried from relays
  });

  it("backend error falls through to a relay fetch (best-effort, never a dependency)", async () => {
    batchMock.mockRejectedValue(new Error("backend down"));
    profileCache.subscribe(PK.d, () => {});

    await wait(350);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(lastRelayAuthors()).toContain(PK.d);
  });

  it("coalesces multiple pubkeys requested in the same window into one backend call", async () => {
    batchMock.mockResolvedValue({ data: [] });
    profileCache.subscribe(PK.a, () => {});
    profileCache.subscribe(PK.b, () => {});
    profileCache.subscribe(PK.e, () => {});

    await wait(350);

    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(batchMock.mock.calls[0][0].sort()).toEqual([PK.a, PK.b, PK.e].sort());
    // All three missed → one relay batch for all.
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(lastRelayAuthors()!.sort()).toEqual([PK.a, PK.b, PK.e].sort());
  });

  it("does not re-fetch a pubkey already resolved in memory", async () => {
    profileCache.handleProfileEvent(kind0(PK.a, 100, "cached"));
    profileCache.subscribe(PK.a, () => {});

    await wait(350);

    expect(batchMock).not.toHaveBeenCalled();
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it("re-checks cache after backend await — skips relay if IDB resolved meanwhile", async () => {
    // Simulate the race I caught from the trace: subscribe schedules the batch,
    // batch fires + awaits backend HTTP, and DURING that await the IDB callback
    // resolves the same pubkey. Without the post-await re-check, we'd waste a
    // 21-relay REQ on profiles we already have locally.
    let resolveBackend!: (rows: Array<ReturnType<typeof row>>) => void;
    batchMock.mockImplementation(
      () => new Promise((r) => { resolveBackend = (rows) => r({ data: rows }); }),
    );

    profileCache.subscribe(PK.a, () => {});
    await wait(80); // past debounce → flushBatch is now awaiting backend

    // Simulate IDB hit landing while backend HTTP is pending.
    profileCache.handleProfileEvent(kind0(PK.a, 1000, "from-idb"));
    expect(profileCache.getCached(PK.a)?.name).toBe("from-idb");

    // Backend returns empty.
    resolveBackend([]);
    await wait(10); // flush microtasks so flushBatch's post-await branch runs

    // The re-check should have caught the IDB-populated cache → no relay REQ.
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});

describe("profileCache backend timeout", () => {
  it("bounds the backend wait — falls through to relay if the HTTP call hangs past BACKEND_TIMEOUT_MS", async () => {
    // Signal-aware mock: respects AbortSignal so AbortSignal.timeout(800) actually
    // bites. Without this guard, a flaky backend could block UI for seconds.
    batchMock.mockImplementation((_pubkeys: string[], signal?: AbortSignal) => {
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
        // otherwise never resolves
      });
    });

    profileCache.subscribe(PK.a, () => {});
    // 50 ms debounce + 800 ms backend timeout = ~850 ms. Wait a bit more for slack.
    await wait(1100);

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(lastRelayAuthors()).toContain(PK.a);
  }, 2000);
});

describe("profileCache IDB read coalescing", () => {
  it("fires a single IDB read for many concurrent subscribes to the same uncached author", () => {
    getProfileMock.mockClear();
    const unsubs = Array.from({ length: 50 }, () =>
      profileCache.subscribe(PK.a, () => {}),
    );
    // 50 cards on one author's profile → ONE IDB read, not 50.
    expect(getProfileMock).toHaveBeenCalledTimes(1);
    expect(getProfileMock).toHaveBeenCalledWith(PK.a);
    unsubs.forEach((u) => u());
  });

  it("still reads each distinct author once", () => {
    getProfileMock.mockClear();
    profileCache.subscribe(PK.a, () => {});
    profileCache.subscribe(PK.b, () => {});
    profileCache.subscribe(PK.a, () => {}); // duplicate — coalesced
    expect(getProfileMock).toHaveBeenCalledTimes(2); // a, b
  });
});
