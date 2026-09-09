import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { Scene } from "@/lib/api/discover";

vi.mock("@/lib/api/discover", () => ({ discoverScenes: vi.fn() }));

import { discoverScenes } from "@/lib/api/discover";
import { FALLBACK_SCENES } from "../taxonomy";
import { resetScenesCache, useScenes } from "../useScenes";

const mockScenes = vi.mocked(discoverScenes);

function serverScene(slug: string): Scene {
  return {
    slug,
    label: slug.toUpperCase(),
    description: null,
    genres: [],
    tags: [],
    spaceCount: 1,
    position: 10,
  };
}

describe("useScenes", () => {
  beforeEach(() => {
    mockScenes.mockReset();
    // The hook caches module-side so one fetch serves every consumer; each
    // case needs that cache cleared to exercise the first-load path.
    resetScenesCache();
  });

  it("paints the bundled fallback on the very first frame", () => {
    // Discover is the landing surface — a momentarily chipless browse row
    // reads as a broken app, so the hook must never start empty.
    mockScenes.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useScenes());
    expect(result.current).toEqual([...FALLBACK_SCENES]);
    expect(result.current.length).toBeGreaterThan(0);
  });

  it("replaces the fallback with the server list once it arrives", async () => {
    mockScenes.mockResolvedValue({ data: [serverScene("only-from-server")] });
    const { result } = renderHook(() => useScenes());
    await waitFor(() => {
      expect(result.current.map((s) => s.slug)).toEqual(["only-from-server"]);
    });
  });

  it("keeps the fallback standing when the endpoint fails", async () => {
    mockScenes.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useScenes());
    await waitFor(() => expect(mockScenes).toHaveBeenCalled());
    expect(result.current).toEqual([...FALLBACK_SCENES]);
  });

  it("ignores an empty server list rather than blanking the chip row", async () => {
    mockScenes.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useScenes());
    await waitFor(() => expect(mockScenes).toHaveBeenCalled());
    expect(result.current).toEqual([...FALLBACK_SCENES]);
  });

  it("fetches once and serves the cache to later consumers", async () => {
    mockScenes.mockResolvedValue({ data: [serverScene("cached")] });
    const first = renderHook(() => useScenes());
    await waitFor(() => expect(first.result.current[0].slug).toBe("cached"));

    const second = renderHook(() => useScenes());
    expect(second.result.current[0].slug).toBe("cached"); // no fallback flash
    expect(mockScenes).toHaveBeenCalledTimes(1);
  });
});
