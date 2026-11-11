import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import type { NostrEvent } from "@/types/nostr";
import type { Space } from "@/types/space";

vi.mock("@/lib/api/spaces", () => ({ getSpace: vi.fn(), fetchFeedSources: vi.fn() }));
vi.mock("@/lib/nostr/groupSubscriptions", () => ({ switchSpaceChannel: vi.fn() }));
vi.mock("@/lib/api/channels", () => ({ fetchChannels: vi.fn(), fetchLayout: vi.fn() }));
vi.mock("@/lib/api/roles", () => ({
  fetchRoles: vi.fn(),
  fetchMyChannelPermissions: vi.fn(),
  fetchAllMemberRoles: vi.fn(),
}));
vi.mock("@/lib/api/moderation", () => ({ fetchBans: vi.fn(), fetchMutes: vi.fn() }));
vi.mock("@/features/spaces/spaceCleanup", () => ({ cleanupSpaceState: vi.fn() }));

import * as spacesApi from "@/lib/api/spaces";
import * as channelsApi from "@/lib/api/channels";
import * as rolesApi from "@/lib/api/roles";
import * as moderationApi from "@/lib/api/moderation";
import { cleanupSpaceState } from "@/features/spaces/spaceCleanup";
import { switchSpaceChannel } from "@/lib/nostr/groupSubscriptions";
import {
  parseSpaceConfigChanged,
  scheduleSpaceConfigSync,
  syncSpaceConfig,
  _resetPendingConfigSyncs,
  CONFIG_SYNC_DEBOUNCE_MS,
} from "../spaceConfigSync";
import { _resetInFlight } from "../spaceMembers";
import { ApiRequestError } from "@/lib/api/client";

const getSpace = vi.mocked(spacesApi.getSpace);
const fetchFeedSources = vi.mocked(spacesApi.fetchFeedSources);
const fetchChannels = vi.mocked(channelsApi.fetchChannels);
const fetchLayout = vi.mocked(channelsApi.fetchLayout);
const fetchRoles = vi.mocked(rolesApi.fetchRoles);
const fetchMyChannelPermissions = vi.mocked(rolesApi.fetchMyChannelPermissions);
const fetchAllMemberRoles = vi.mocked(rolesApi.fetchAllMemberRoles);
const fetchBans = vi.mocked(moderationApi.fetchBans);
const fetchMutes = vi.mocked(moderationApi.fetchMutes);

function nudge(spaceId: string, whats: string[]): NostrEvent {
  return {
    id: "n1",
    pubkey: "b".repeat(64),
    created_at: 1,
    kind: 20900,
    tags: [["d", spaceId], ...whats.map((w) => ["what", w])],
    content: "",
    sig: "",
  };
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    name: "Old name",
    hostRelay: "wss://relay.test.com",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    creatorPubkey: "a".repeat(64),
    createdAt: 1,
    ...overrides,
  };
}

function storeWith(space: Space | null, active?: { channelId: string; channels: unknown[] }) {
  return createTestStore({
    spaces: {
      list: space ? [space] : [],
      activeSpaceId: active && space ? space.id : null,
      activeChannelId: active && space ? `${space.id}:${active.channelId}` : null,
      subscriptions: {},
      channels: active && space ? { [space.id]: active.channels as never } : {},
      channelsLoading: {},
      categories: {},
      layoutRevision: {},
      layoutSupported: {},
      pendingInvites: [],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetPendingConfigSyncs();
  _resetInFlight();
  fetchAllMemberRoles.mockResolvedValue([]);
  fetchMyChannelPermissions.mockResolvedValue({ spacePermissions: [], channelOverrides: {} });
});

describe("parseSpaceConfigChanged", () => {
  it("reads the d tag and the known what tags, dropping unknown ones", () => {
    expect(parseSpaceConfigChanged(nudge("sp", ["channels", "bogus", "meta"]))).toEqual({
      spaceId: "sp",
      changes: ["channels", "meta"],
    });
  });
  it("is null without a d tag or without a known what", () => {
    expect(parseSpaceConfigChanged({ ...nudge("sp", ["x"]) })).toBeNull();
    expect(parseSpaceConfigChanged({ ...nudge("sp", ["meta"]), tags: [["what", "meta"]] })).toBeNull();
  });
});

describe("syncSpaceConfig", () => {
  it("refetches channels and applies the backend's metadata on 'meta' + 'channels'", async () => {
    const store = storeWith(makeSpace());
    getSpace.mockResolvedValue({
      data: { id: "space-1", name: "New name", about: "fresh", picture: null } as never,
    });
    fetchLayout.mockResolvedValue({
      revision: 3,
      categories: [{ id: "Dev", spaceId: "space-1", name: "Development", position: 0 }],
      channels: [
        { id: "c1", spaceId: "space-1", type: "chat", label: "#general", categoryId: "Dev", position: 0, isDefault: true, adminOnly: false, slowModeSeconds: 0 } as never,
      ],
    });
    await store.dispatch(syncSpaceConfig("space-1", ["meta", "channels"]) as never);
    const space = store.getState().spaces.list[0];
    expect(space.name).toBe("New name");
    expect(space.about).toBe("fresh");
    expect(space.picture).toBeUndefined();
    expect(store.getState().spaces.channels["space-1"]).toHaveLength(1);
    expect(store.getState().spaces.channels["space-1"][0].feedMode).toBe("all");
    expect(store.getState().spaces.categories["space-1"].map((c) => c.name)).toEqual(["Development"]);
    expect(store.getState().spaces.layoutRevision["space-1"]).toBe(3);
    expect(store.getState().spaces.layoutSupported["space-1"]).toBe(true);
    expect(fetchChannels).not.toHaveBeenCalled();
    expect(fetchRoles).not.toHaveBeenCalled();
  });

  it("falls back to the flat channel list when the backend predates subfolders (404)", async () => {
    const store = storeWith(makeSpace());
    fetchLayout.mockRejectedValue(new ApiRequestError(404, "NOT_FOUND", "Not Found"));
    fetchChannels.mockResolvedValue([
      { id: "c1", spaceId: "space-1", type: "chat", label: "#general", categoryId: "Dev", position: 0, isDefault: true, adminOnly: false, slowModeSeconds: 0 } as never,
    ]);
    await store.dispatch(syncSpaceConfig("space-1", ["channels"]) as never);
    expect(store.getState().spaces.channels["space-1"]).toHaveLength(1);
    expect(store.getState().spaces.layoutSupported["space-1"]).toBe(false);
    expect(store.getState().spaces.categories["space-1"]).toBeUndefined();
  });

  it("refetches roles, members and my permissions on 'roles' / 'members'; one failure doesn't block the rest", async () => {
    const store = storeWith(makeSpace());
    fetchRoles.mockRejectedValue(new Error("boom"));
    fetchMyChannelPermissions.mockResolvedValue({ spacePermissions: ["MANAGE_SPACE"], channelOverrides: {} });
    fetchAllMemberRoles.mockResolvedValue([{ pubkey: "c".repeat(64), roles: [], joinedAt: 1 }]);
    await store.dispatch(syncSpaceConfig("space-1", ["roles", "members"]) as never);
    expect(fetchRoles).toHaveBeenCalledWith("space-1");
    expect(fetchAllMemberRoles).toHaveBeenCalledWith("space-1");
    expect(store.getState().spaceConfig.myPermissions["space-1"]).toEqual(["MANAGE_SPACE"]);
    expect(store.getState().spaces.list[0].memberPubkeys).toEqual(["c".repeat(64)]);
  });

  it("refetches feed sources on 'feed' and re-subscribes the open channel with them", async () => {
    const space = makeSpace({ mode: "read", feedPubkeys: ["d".repeat(64)] });
    const notes = { id: "c-notes", spaceId: "space-1", type: "notes", label: "#notes", position: 0 };
    const store = storeWith(space, { channelId: "c-notes", channels: [notes] });
    fetchFeedSources.mockResolvedValue({ data: ["d".repeat(64), "e".repeat(64)] } as never);
    await store.dispatch(syncSpaceConfig("space-1", ["feed"]) as never);
    expect(fetchFeedSources).toHaveBeenCalledWith("space-1");
    expect(store.getState().spaces.list[0].feedPubkeys).toEqual(["d".repeat(64), "e".repeat(64)]);
    expect(switchSpaceChannel).toHaveBeenCalledTimes(1);
    const [resubscribed, type, channelId] = vi.mocked(switchSpaceChannel).mock.calls[0];
    expect(resubscribed.feedPubkeys).toEqual(["d".repeat(64), "e".repeat(64)]);
    expect([type, channelId]).toEqual(["notes", "c-notes"]);
    expect(getSpace).not.toHaveBeenCalled();
  });

  it("'feed' for a space that isn't open updates the list without touching subscriptions", async () => {
    const store = storeWith(makeSpace({ mode: "read" }));
    fetchFeedSources.mockResolvedValue({ data: ["e".repeat(64)] } as never);
    await store.dispatch(syncSpaceConfig("space-1", ["feed"]) as never);
    expect(store.getState().spaces.list[0].feedPubkeys).toEqual(["e".repeat(64)]);
    expect(switchSpaceChannel).not.toHaveBeenCalled();
  });

  it("fetches bans/mutes on 'moderation' only when the viewer moderates", async () => {
    const store = storeWith(makeSpace());
    await store.dispatch(syncSpaceConfig("space-1", ["moderation"]) as never);
    expect(fetchBans).not.toHaveBeenCalled();
    store.dispatch({ type: "spaceConfig/setMyPermissions", payload: { spaceId: "space-1", permissions: ["BAN_MEMBERS"] } });
    fetchBans.mockResolvedValue([]);
    fetchMutes.mockResolvedValue([]);
    await store.dispatch(syncSpaceConfig("space-1", ["moderation"]) as never);
    expect(fetchBans).toHaveBeenCalledWith("space-1");
    expect(fetchMutes).toHaveBeenCalledWith("space-1");
  });

  it("'deleted' tears the space down locally and fetches nothing", async () => {
    const store = storeWith(makeSpace());
    await store.dispatch(syncSpaceConfig("space-1", ["deleted", "meta"]) as never);
    expect(cleanupSpaceState).toHaveBeenCalledWith("space-1", expect.any(Function));
    expect(getSpace).not.toHaveBeenCalled();
  });

  it("ignores spaces that aren't in the store and NIP-29-native ones", async () => {
    const store = storeWith(makeSpace({ spaceType: "nip29-native" }));
    await store.dispatch(syncSpaceConfig("space-1", ["channels"]) as never);
    await store.dispatch(syncSpaceConfig("nope", ["channels"]) as never);
    expect(fetchLayout).not.toHaveBeenCalled();
    expect(fetchChannels).not.toHaveBeenCalled();
  });
});

describe("scheduleSpaceConfigSync", () => {
  it("coalesces a burst into one sync carrying the union", async () => {
    vi.useFakeTimers();
    try {
      const store = storeWith(makeSpace());
      fetchLayout.mockResolvedValue({ revision: 0, categories: [], channels: [] });
      fetchRoles.mockResolvedValue([]);
      scheduleSpaceConfigSync("space-1", ["channels"], store.dispatch as never);
      scheduleSpaceConfigSync("space-1", ["roles"], store.dispatch as never);
      scheduleSpaceConfigSync("space-1", ["channels"], store.dispatch as never);
      expect(fetchLayout).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(CONFIG_SYNC_DEBOUNCE_MS + 1);
      expect(fetchLayout).toHaveBeenCalledTimes(1);
      expect(fetchRoles).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
