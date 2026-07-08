import { cachedSpaceChannels, cachedSpaceDetail, clearSpaceCache, invalidateSpace } from "../spaceCache";
import { fetchSpaceChannels, fetchSpaceDetail } from "../spaces";

jest.mock("../spaces", () => ({
  fetchSpaceDetail: jest.fn(),
  fetchSpaceChannels: jest.fn(),
}));

const mockDetail = fetchSpaceDetail as jest.Mock;
const mockChannels = fetchSpaceChannels as jest.Mock;

describe("spaceCache", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    clearSpaceCache();
    mockDetail.mockReset().mockResolvedValue({ id: "s1", name: "S1" });
    mockChannels.mockReset().mockResolvedValue([{ id: "c1" }]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("dedupes concurrent + repeated reads inside the TTL window", async () => {
    const [a, b] = await Promise.all([cachedSpaceDetail("s1"), cachedSpaceDetail("s1")]);
    expect(a).toBe(b);
    await cachedSpaceDetail("s1");
    expect(mockDetail).toHaveBeenCalledTimes(1);
  });

  it("refetches once the TTL elapses", async () => {
    await cachedSpaceDetail("s1");
    jest.setSystemTime(46_000);
    await cachedSpaceDetail("s1");
    expect(mockDetail).toHaveBeenCalledTimes(2);
  });

  it("keys by spaceId", async () => {
    await cachedSpaceDetail("s1");
    await cachedSpaceDetail("s2");
    expect(mockDetail).toHaveBeenCalledTimes(2);
  });

  it("invalidateSpace forces a refetch of both stores", async () => {
    await cachedSpaceDetail("s1");
    await cachedSpaceChannels("s1");
    invalidateSpace("s1");
    await cachedSpaceDetail("s1");
    await cachedSpaceChannels("s1");
    expect(mockDetail).toHaveBeenCalledTimes(2);
    expect(mockChannels).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    mockDetail.mockRejectedValueOnce(new Error("down"));
    await expect(cachedSpaceDetail("s1")).rejects.toThrow("down");
    // Rejection handler runs on a microtask — let it clear the entry.
    await Promise.resolve();
    await expect(cachedSpaceDetail("s1")).resolves.toEqual({ id: "s1", name: "S1" });
    expect(mockDetail).toHaveBeenCalledTimes(2);
  });
});
