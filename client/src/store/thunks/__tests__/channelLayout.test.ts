import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import type { Space, SpaceChannel, SpaceChannelCategory } from "@/types/space";
import type { UnsignedEvent } from "@/types/nostr";

vi.mock("@/lib/api/channels", () => ({
  fetchChannels: vi.fn(),
  fetchLayout: vi.fn(),
  putLayout: vi.fn(),
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
  syncChannelPermissions: vi.fn(),
}));
vi.mock("@/lib/nostr/publish", () => ({ signAndPublish: vi.fn() }));

import * as channelsApi from "@/lib/api/channels";
import { signAndPublish } from "@/lib/nostr/publish";
import { ApiRequestError } from "@/lib/api/client";
import {
  applyChannelLayoutOp,
  createChannelCategory,
  createSpaceChannel,
  deleteSpaceChannel,
  loadChannelLayout,
} from "../channelLayout";
import { moveChannel, renameCategory, TreeOpError } from "@/features/spaces/channelTree";
import { setNativeLayoutLoaded } from "@/features/spaces/nip29SpaceSync";

const api = vi.mocked(channelsApi);
const publish = vi.mocked(signAndPublish);

const ME = "a".repeat(64);
const S = "space-1";

function space(overrides: Partial<Space> = {}): Space {
  return {
    id: S,
    name: "Space",
    hostRelay: "wss://relay.test.com",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    creatorPubkey: ME,
    createdAt: 1,
    ...overrides,
  };
}

function ch(id: string, position: number, categoryId: string | null = null, extra: Partial<SpaceChannel> = {}): SpaceChannel {
  return {
    id,
    spaceId: S,
    type: "chat",
    label: `#${id}`,
    categoryId,
    position,
    isDefault: position === 0,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
    ...extra,
  };
}

const cat = (id: string, position: number, name = id): SpaceChannelCategory => ({ id, spaceId: S, name, position });

function storeWith(sp: Space, channels: SpaceChannel[], categories?: SpaceChannelCategory[], revision?: number) {
  return createTestStore({
    identity: { pubkey: ME } as never,
    spaces: {
      list: [sp],
      activeSpaceId: null,
      activeChannelId: null,
      subscriptions: {},
      channels: { [S]: channels },
      categories: categories ? { [S]: categories } : {},
      layoutRevision: revision !== undefined ? { [S]: revision } : {},
      layoutSupported: revision !== undefined ? { [S]: true } : {},
      channelsLoading: {},
      pendingInvites: [],
    },
  });
}

const labels = (store: ReturnType<typeof storeWith>) =>
  [...store.getState().spaces.channels[S]].sort((a, b) => a.position - b.position).map((c) => `${c.id}@${c.categoryId ?? "-"}`);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadChannelLayout", () => {
  it("hydrates channels, categories and revision", async () => {
    const store = storeWith(space(), []);
    api.fetchLayout.mockResolvedValue({ revision: 4, categories: [cat("T", 0)], channels: [ch("a", 0, "T")] });
    await store.dispatch(loadChannelLayout(S) as never);
    expect(store.getState().spaces.layoutRevision[S]).toBe(4);
    expect(store.getState().spaces.categories[S]).toEqual([cat("T", 0)]);
    expect(store.getState().spaces.layoutSupported[S]).toBe(true);
  });

  it("a missing space (the route's own NOT_FOUND) falls back without deciding support", async () => {
    const store = storeWith(space(), []);
    api.fetchLayout.mockRejectedValue(new ApiRequestError(404, "NOT_FOUND", "Space not found"));
    api.fetchChannels.mockResolvedValue([]);
    await store.dispatch(loadChannelLayout(S) as never);
    expect(store.getState().spaces.layoutSupported[S]).toBeUndefined();
  });

  it("an unknown route (older backend) marks subfolder management unsupported", async () => {
    const store = storeWith(space(), []);
    api.fetchLayout.mockRejectedValue(new ApiRequestError(404, undefined as never, "Not Found"));
    api.fetchChannels.mockResolvedValue([ch("a", 0, "Legacy")]);
    await store.dispatch(loadChannelLayout(S) as never);
    expect(store.getState().spaces.layoutSupported[S]).toBe(false);
    expect(store.getState().spaces.channels[S]).toHaveLength(1);
  });

  it("propagates errors other than 404", async () => {
    const store = storeWith(space(), []);
    api.fetchLayout.mockRejectedValue(new ApiRequestError(500, "X", "boom"));
    await expect(store.dispatch(loadChannelLayout(S) as never)).rejects.toThrow("boom");
    expect(api.fetchChannels).not.toHaveBeenCalled();
  });
});

describe("applyChannelLayoutOp (backend spaces)", () => {
  it("applies optimistically, PUTs the full document, then adopts the server's answer", async () => {
    const store = storeWith(space(), [ch("a", 0), ch("b", 1, "T")], [cat("T", 0)], 2);
    let seenDuringPut: string[] = [];
    api.putLayout.mockImplementation(async (_s, doc) => {
      seenDuringPut = labels(store);
      expect(doc).toEqual({ baseRevision: 2, uncategorized: [], categories: [{ id: "T", name: "T", channelIds: ["b", "a"] }] });
      return { revision: 3, categories: [cat("T", 0)], channels: [ch("b", 0, "T"), ch("a", 1, "T")] };
    });
    await store.dispatch(applyChannelLayoutOp(S, moveChannel("a", "T", 1)) as never);
    expect(seenDuringPut).toEqual(["b@T", "a@T"]); // optimistic
    expect(store.getState().spaces.layoutRevision[S]).toBe(3);
  });

  it("rolls back on failure", async () => {
    const store = storeWith(space(), [ch("a", 0), ch("b", 1, "T")], [cat("T", 0)], 2);
    api.putLayout.mockRejectedValue(new ApiRequestError(403, "FORBIDDEN", "nope"));
    await expect(store.dispatch(applyChannelLayoutOp(S, moveChannel("a", "T", 1)) as never)).rejects.toThrow("nope");
    expect(labels(store)).toEqual(["a@-", "b@T"]);
    expect(store.getState().spaces.categories[S]).toEqual([cat("T", 0)]);
  });

  it("on 409 refetches and re-applies the same edit to the fresh layout once", async () => {
    const store = storeWith(space(), [ch("a", 0), ch("b", 1, "T")], [cat("T", 0)], 2);
    api.putLayout
      .mockRejectedValueOnce(new ApiRequestError(409, "LAYOUT_STALE", "stale"))
      .mockImplementationOnce(async (_s, doc) => {
        // Re-applied against the fresh layout (which gained channel "c").
        expect(doc.baseRevision).toBe(5);
        expect(doc.categories[0].channelIds).toEqual(["b", "a"]);
        expect(doc.uncategorized).toEqual(["c"]);
        return { revision: 6, categories: [cat("T", 0)], channels: [ch("c", 0), ch("b", 1, "T"), ch("a", 2, "T")] };
      });
    api.fetchLayout.mockResolvedValue({ revision: 5, categories: [cat("T", 0)], channels: [ch("a", 0), ch("c", 1), ch("b", 2, "T")] });
    await store.dispatch(applyChannelLayoutOp(S, moveChannel("a", "T", 1)) as never);
    expect(api.putLayout).toHaveBeenCalledTimes(2);
    expect(store.getState().spaces.layoutRevision[S]).toBe(6);
  });

  it("gives up after a second 409 and leaves the fresh layout", async () => {
    const store = storeWith(space(), [ch("a", 0)], [cat("T", 0)], 2);
    api.putLayout.mockRejectedValue(new ApiRequestError(409, "LAYOUT_STALE", "stale"));
    api.fetchLayout.mockResolvedValue({ revision: 7, categories: [cat("T", 0, "Fresh")], channels: [ch("a", 0)] });
    await expect(store.dispatch(applyChannelLayoutOp(S, moveChannel("a", "T", 0)) as never)).rejects.toThrow("stale");
    expect(api.putLayout).toHaveBeenCalledTimes(2);
    expect(store.getState().spaces.categories[S][0].name).toBe("Fresh");
    expect(labels(store)).toEqual(["a@-"]);
  });

  it("serializes writes: the second edit starts from the first one's result", async () => {
    const store = storeWith(space(), [ch("a", 0), ch("b", 1)], [cat("T", 0)], 1);
    const docs: unknown[] = [];
    api.putLayout.mockImplementation(async (_s, doc) => {
      docs.push(doc);
      const rev = doc.baseRevision + 1;
      // Echo the document back as the saved layout.
      let pos = 0;
      const channels = [
        ...doc.uncategorized.map((id) => ch(id, pos++)),
        ...doc.categories.flatMap((c) => c.channelIds.map((id) => ch(id, pos++, c.id!))),
      ];
      return { revision: rev, categories: [cat("T", 0)], channels };
    });
    await Promise.all([
      store.dispatch(applyChannelLayoutOp(S, moveChannel("a", "T", 0)) as never),
      store.dispatch(applyChannelLayoutOp(S, moveChannel("b", "T", 1)) as never),
    ]);
    expect((docs[0] as { baseRevision: number }).baseRevision).toBe(1);
    expect((docs[1] as { baseRevision: number }).baseRevision).toBe(2);
    expect(labels(store)).toEqual(["a@T", "b@T"]);
  });

  it("refuses when the backend predates subfolders", async () => {
    const store = storeWith(space(), [ch("a", 0, "Legacy")]);
    api.fetchLayout.mockRejectedValue(new ApiRequestError(404, undefined as never, "Not Found"));
    api.fetchChannels.mockResolvedValue([ch("a", 0, "Legacy")]);
    await expect(store.dispatch(applyChannelLayoutOp(S, renameCategory("Legacy", "New")) as never)).rejects.toThrow(
      /doesn't support subfolders/,
    );
    expect(api.putLayout).not.toHaveBeenCalled();
  });

  it("surfaces an invalid op without touching state", async () => {
    const store = storeWith(space(), [ch("a", 0)], [], 1);
    await expect(store.dispatch(applyChannelLayoutOp(S, moveChannel("ghost", null, 0)) as never)).rejects.toBeInstanceOf(
      TreeOpError,
    );
    expect(api.putLayout).not.toHaveBeenCalled();
  });

  it("createChannelCategory resolves to the id the server assigned", async () => {
    const store = storeWith(space(), [ch("a", 0)], [], 1);
    api.putLayout.mockImplementation(async (_s, doc) => {
      expect(doc.categories).toEqual([{ name: "Dev Ops", channelIds: [] }]);
      return { revision: 2, categories: [cat("Dev Ops", 0)], channels: [ch("a", 0)] };
    });
    await expect(store.dispatch(createChannelCategory(S, "  Dev Ops ") as never)).resolves.toBe("Dev Ops");
  });

  it("REST channel writes refetch the layout afterwards", async () => {
    const store = storeWith(space(), [ch("a", 0)], [cat("T", 0)], 1);
    api.createChannel.mockResolvedValue(ch("n", 1, "T"));
    api.fetchLayout.mockResolvedValue({ revision: 2, categories: [cat("T", 0)], channels: [ch("a", 0), ch("n", 1, "T")] });
    await store.dispatch(createSpaceChannel(S, { type: "chat", label: "#n", categoryId: "T" }) as never);
    expect(api.createChannel).toHaveBeenCalledWith(S, { type: "chat", label: "#n", categoryId: "T" });
    expect(store.getState().spaces.layoutRevision[S]).toBe(2);
  });
});

describe("relay-only spaces", () => {
  const native = () => space({ spaceType: "nip29-native" });
  beforeEach(() => setNativeLayoutLoaded(S, true));

  it("refuses to publish before the relay's layout has loaded (it would overwrite it)", async () => {
    setNativeLayoutLoaded(S, false);
    const store = storeWith(native(), [ch("chat", 0, null, { isDefault: true }), ch("b", 1)], []);
    await expect(store.dispatch(applyChannelLayoutOp(S, moveChannel("b", null, 0)) as never)).rejects.toThrow(/still loading/);
    expect(publish).not.toHaveBeenCalled();
    expect(labels(store)).toEqual(["chat@-", "b@-"]);
  });

  it("publishes a signed, h-tagged layout event with the default pinned and applies it optimistically", async () => {
    const store = storeWith(native(), [ch("chat", 0, null, { isDefault: true }), ch("b", 1)], undefined);
    let published: UnsignedEvent | undefined;
    publish.mockImplementation(async (ev) => {
      published = ev;
      return { ...ev, id: "x", sig: "y" } as never;
    });
    const id = await store.dispatch(createChannelCategory(S, "Hangout") as never);
    expect(id).toBe("Hangout");
    await store.dispatch(applyChannelLayoutOp(S, moveChannel("b", "Hangout", 0)) as never);
    expect(published!.kind).toBe(30078);
    expect(published!.tags).toContainEqual(["h", S]);
    expect(published!.tags).toContainEqual(["d", `wired:layout:${S}`]);
    expect(published!.tags).toContainEqual(["category", "Hangout", "Hangout", "0"]);
    expect(published!.tags).toContainEqual(["default", "chat"]);
    expect(labels(store)).toEqual(["chat@-", "b@Hangout"]);
    expect(api.putLayout).not.toHaveBeenCalled();
  });

  it("rolls back when publishing fails, and refuses non-admins", async () => {
    const store = storeWith(native(), [ch("chat", 0, null, { isDefault: true }), ch("b", 1)], []);
    publish.mockRejectedValue(new Error("relay down"));
    await expect(store.dispatch(applyChannelLayoutOp(S, moveChannel("b", null, 0)) as never)).rejects.toThrow("relay down");
    expect(labels(store)).toEqual(["chat@-", "b@-"]);

    const notMine = storeWith(space({ spaceType: "nip29-native", creatorPubkey: "z".repeat(64) }), [ch("chat", 0)], []);
    await expect(notMine.dispatch(applyChannelLayoutOp(S, moveChannel("chat", null, 0)) as never)).rejects.toThrow(
      /Only this space's admins/,
    );
  });

  it("never deletes the main chat", async () => {
    const store = storeWith(native(), [ch("chat", 0, null, { isDefault: true }), ch("b", 1)], []);
    await expect(store.dispatch(deleteSpaceChannel(S, "chat") as never)).rejects.toThrow(/main chat/);
    expect(publish).not.toHaveBeenCalled();
    publish.mockResolvedValue({} as never);
    await store.dispatch(deleteSpaceChannel(S, "b") as never);
    expect(labels(store)).toEqual(["chat@-"]);
  });

  it("creates channels inside the layout (no backend call)", async () => {
    const store = storeWith(native(), [ch("chat", 0, null, { isDefault: true })], [cat("T", 0)]);
    publish.mockResolvedValue({} as never);
    const created = await store.dispatch(createSpaceChannel(S, { type: "voice", label: "#talk", categoryId: "T" }) as never);
    expect((created as SpaceChannel).type).toBe("voice");
    expect(api.createChannel).not.toHaveBeenCalled();
    expect(labels(store)).toEqual(["chat@-", `${(created as SpaceChannel).id}@T`]);
  });
});
