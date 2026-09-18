import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApi = vi.fn();
vi.mock("../client", () => ({ api: (...a: unknown[]) => mockApi(...a) }));

import { suppressPushForEvents } from "../push";

beforeEach(() => mockApi.mockReset());

describe("suppressPushForEvents", () => {
  it("posts the self-wrap ids to /push/suppress", async () => {
    mockApi.mockResolvedValue({ data: { success: true } });
    await suppressPushForEvents(["a".repeat(64)]);
    expect(mockApi).toHaveBeenCalledWith("/push/suppress", {
      method: "POST",
      body: { eventIds: ["a".repeat(64)] },
    });
  });

  it("is a no-op for an empty list and swallows backend failures", async () => {
    await suppressPushForEvents([]);
    expect(mockApi).not.toHaveBeenCalled();
    mockApi.mockImplementationOnce(async () => {
      throw new Error("backend down");
    });
    await expect(suppressPushForEvents(["b".repeat(64)])).resolves.toBeUndefined();
    expect(mockApi).toHaveBeenCalledTimes(1);
  });
});
