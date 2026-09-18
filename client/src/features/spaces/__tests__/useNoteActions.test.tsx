import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";
import type { Space } from "@/types/space";

const mockSignAndPublish = vi.fn();
vi.mock("@/lib/nostr/publish", () => ({
  signAndPublish: (...a: unknown[]) => mockSignAndPublish(...a),
}));

// `reactionToggle` reads the app singleton store, so the hook is rendered
// against that same store rather than a throwaway test store.
import { store, resetAll } from "@/store";
import { relayManager } from "@/lib/nostr/relayManager";
import { login } from "@/store/slices/identitySlice";
import { setSpaces, setActiveSpace } from "@/store/slices/spacesSlice";
import { addReaction, selectReactionCount } from "@/store/slices/reactionsSlice";
import { useNoteActions } from "../useNoteActions";
import { useProfileNoteActions } from "@/features/profile/useProfileNoteActions";

vi.spyOn(relayManager, "connect").mockImplementation(() => undefined as never);

const ME = "a".repeat(64);
const AUTHOR = "b".repeat(64);
const HOST = "wss://host.example";

const note: NostrEvent = {
  id: "note1",
  pubkey: AUTHOR,
  created_at: 1,
  kind: 1,
  tags: [],
  content: "hi",
  sig: "",
};

const space: Space = {
  id: "space-1",
  name: "Space",
  hostRelay: HOST,
  mode: "read-write",
  isPrivate: false,
  adminPubkeys: [],
  memberPubkeys: [],
  feedPubkeys: [],
  creatorPubkey: AUTHOR,
  createdAt: 0,
};

function wrapper({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

const published = () => mockSignAndPublish.mock.calls.map((c) => c[0] as UnsignedEvent);

beforeEach(() => {
  store.dispatch(resetAll());
  mockSignAndPublish.mockReset();
  mockSignAndPublish.mockImplementation(async (u: UnsignedEvent) => ({ ...u, id: "signed", sig: "" }));
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
});

describe("useNoteActions.like (space feed)", () => {
  it("publishes a + kind:7 to the host relay when not yet liked", async () => {
    store.dispatch(setSpaces([space]));
    store.dispatch(setActiveSpace("space-1"));
    const { result } = renderHook(() => useNoteActions(note), { wrapper });
    await act(() => result.current.like());
    expect(published()).toHaveLength(1);
    expect(published()[0].kind).toBe(7);
    expect(published()[0].content).toBe("+");
    expect(mockSignAndPublish.mock.calls[0][1]).toEqual([HOST]);
  });

  it("publishes a kind:5 for the existing reaction when already liked (no duplicate kind:7)", async () => {
    store.dispatch(setSpaces([space]));
    store.dispatch(setActiveSpace("space-1"));
    store.dispatch(addReaction({ targetEventId: "note1", reactor: ME, content: "+", eventId: "rx1" }));
    const { result } = renderHook(() => useNoteActions(note), { wrapper });
    await act(() => result.current.like());
    expect(published()).toHaveLength(1);
    expect(published()[0].kind).toBe(5);
    expect(published()[0].tags).toEqual([["e", "rx1"], ["k", "7"]]);
    expect(mockSignAndPublish.mock.calls[0][1]).toEqual([HOST]);
    expect(selectReactionCount(store.getState(), "note1")).toBe(0);
  });
});

describe("useProfileNoteActions.like (profile / thread / embeds)", () => {
  it("toggles between kind:7 and kind:5 on the user's write relays", async () => {
    const { result } = renderHook(() => useProfileNoteActions(note), { wrapper });
    await act(() => result.current.like());
    expect(published()[0].kind).toBe(7);
    expect(mockSignAndPublish.mock.calls[0][1]).toBeUndefined();

    // Simulate the local pipeline pass having folded the kind:7 in.
    store.dispatch(addReaction({ targetEventId: "note1", reactor: ME, content: "+", eventId: "signed" }));
    await act(() => result.current.like());
    expect(published()[1].kind).toBe(5);
    expect(published()[1].tags).toEqual([["e", "signed"], ["k", "7"]]);
  });
});
