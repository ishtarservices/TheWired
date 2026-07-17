import {
  MEMBERSHIP_WINDOW_MS,
  clearMembership,
  fetchMembershipRoster,
  invalidateMembership,
  isMemberOf,
} from "../membership";

// membership.ts goes straight to fetch (no parser indirection to mock) —
// stub the network. Ported window/dedup cases from the deleted
// spaceCache.test.ts; the throwing contract is membership's own.

const fetchMock = jest.fn();
const realFetch = globalThis.fetch;

function okRoster(pubkeys: string[]) {
  return {
    ok: true,
    json: async () => ({ data: pubkeys.map((pubkey) => ({ pubkey })) }),
  };
}

beforeAll(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  clearMembership();
  fetchMock.mockReset().mockResolvedValue(okRoster(["a".repeat(64)]));
});

afterEach(() => {
  jest.useRealTimers();
});

describe("fetchMembershipRoster", () => {
  it("dedupes concurrent + repeated reads inside the 10s window", async () => {
    const [a, b] = await Promise.all([
      fetchMembershipRoster("s1"),
      fetchMembershipRoster("s1"),
    ]);
    expect(a).toEqual(b);
    await fetchMembershipRoster("s1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches once the window elapses", async () => {
    await fetchMembershipRoster("s1");
    jest.setSystemTime(MEMBERSHIP_WINDOW_MS + 1);
    await fetchMembershipRoster("s1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keys by spaceId", async () => {
    await fetchMembershipRoster("s1");
    await fetchMembershipRoster("s2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-ok response (never the []-on-error contract)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchMembershipRoster("s1")).rejects.toThrow("503");
  });

  it("a failure evicts its own promise — the next call refetches", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    await expect(fetchMembershipRoster("s1")).rejects.toThrow("down");
    // Rejection handler runs on a microtask — let it clear the entry.
    await Promise.resolve();
    await expect(fetchMembershipRoster("s1")).resolves.toEqual(["a".repeat(64)]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidateMembership forces a refetch inside the window (join/leave)", async () => {
    await fetchMembershipRoster("s1");
    invalidateMembership("s1");
    await fetchMembershipRoster("s1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("isMemberOf", () => {
  const me = "a".repeat(64);

  it("resolves true for a listed pubkey, false otherwise", async () => {
    await expect(isMemberOf("s1", me)).resolves.toBe(true);
    await expect(isMemberOf("s1", "b".repeat(64))).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // both rode one window
  });

  it("throws on failure — callers must not read a network error as 'not a member'", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(isMemberOf("s1", me)).rejects.toThrow("offline");
  });
});
