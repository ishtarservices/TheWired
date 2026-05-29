import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RelayListEntry } from "@/types/relay";

// Mock only the NIP-65 lookup; use the real relayManager and spy on its closer.
const fetchRelayListMock = vi.fn();
vi.mock("@/lib/nostr/nip65", () => ({
  fetchRelayList: (pubkey: string, onResult: (e: RelayListEntry[]) => void) =>
    fetchRelayListMock(pubkey, onResult),
}));

import { useAuthorWriteRelays } from "../useProfileNotes";
import { relayManager } from "@/lib/nostr/relayManager";

let closeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchRelayListMock.mockReset();
  fetchRelayListMock.mockReturnValue("sub-rl");
  closeSpy = vi.spyOn(relayManager, "closeSubscription").mockImplementation(() => {});
});

afterEach(() => {
  closeSpy.mockRestore();
});

describe("useAuthorWriteRelays (outbox routing)", () => {
  it("returns [] and does not fetch for a null pubkey (own profile)", () => {
    const { result } = renderHook(() => useAuthorWriteRelays(null));
    expect(result.current).toEqual([]);
    expect(fetchRelayListMock).not.toHaveBeenCalled();
  });

  it("returns the author's write relays (write + read+write, never read-only)", () => {
    let cb: ((e: RelayListEntry[]) => void) | undefined;
    fetchRelayListMock.mockImplementation((_pk, onResult) => {
      cb = onResult;
      return "sub-rl";
    });
    const { result } = renderHook(() => useAuthorWriteRelays("author-aaa"));
    expect(result.current).toEqual([]); // nothing until the list arrives
    act(() => {
      cb!([
        { url: "wss://write1", mode: "write" },
        { url: "wss://rw", mode: "read+write" },
        { url: "wss://readonly", mode: "read" },
      ]);
    });
    expect(result.current).toEqual(["wss://write1", "wss://rw"]);
  });

  it("serves a cached relay list on a later visit without refetching", () => {
    let cb: ((e: RelayListEntry[]) => void) | undefined;
    fetchRelayListMock.mockImplementation((_pk, onResult) => {
      cb = onResult;
      return "sub-rl";
    });
    const first = renderHook(() => useAuthorWriteRelays("author-bbb"));
    act(() => cb!([{ url: "wss://bobrelay", mode: "write" }]));
    expect(first.result.current).toEqual(["wss://bobrelay"]);
    first.unmount();

    fetchRelayListMock.mockClear();
    const second = renderHook(() => useAuthorWriteRelays("author-bbb"));
    expect(second.result.current).toEqual(["wss://bobrelay"]); // from cache
    expect(fetchRelayListMock).not.toHaveBeenCalled();
  });

  it("closes the relay-list subscription on unmount", () => {
    fetchRelayListMock.mockReturnValue("sub-xyz");
    const { unmount } = renderHook(() => useAuthorWriteRelays("author-ccc"));
    unmount();
    expect(closeSpy).toHaveBeenCalledWith("sub-xyz");
  });
});
