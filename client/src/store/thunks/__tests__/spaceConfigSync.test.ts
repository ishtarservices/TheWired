import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import type { NostrEvent } from "@/types/nostr";
import type { Space } from "@/types/space";

vi.mock("@/lib/api/spaces", () => ({ getSpace: vi.fn() }));
vi.mock("@/lib/api/channels", () => ({ fetchChannels: vi.fn() }));
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
import {
  parseSpaceConfigChanged,
  scheduleSpaceConfigSync,
  syncSpaceConfig,
  _resetPendingConfigSyncs,
  CONFIG_SYNC_DEBOUNCE_MS,
} from "../spaceConfigSync";
import { _resetInFlight } from "../spaceMembers";

const getSpace = vi.mocked(spacesApi.getSpace);
const fetchChannels = vi.mocked(channelsApi.fetchChannels);
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

function storeWith(space: Space | null) {
  return createTestStore({
    spaces: {
      list: space ? [space] : [],
      activeSpaceId: null,
      activeChannelId: null,
      subscriptions: {},
      channels: {},
      channelsLoading: {},
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
    fetchChannels.mockResolvedValue([
      { id: "c1", spaceId: "space-1", type: "chat", label: "#general", position: 0, isDefault: true, adminOnly: false, slowModeSeconds: 0 } as never,
    ]);
    await store.dispatch(syncSpaceConfig("space-1", ["meta", "channels"]) as never);
    const space = store.getState().spaces.list[0];
    expect(space.name).toBe("New name");
    expect(space.about).toBe("fresh");
    expect(space.picture).toBeUndefined();
    expect(store.getState().spaces.channels["space-1"]).toHaveLength(1);
    expect(store.getState().spaces.channels["space-1"][0].feedMode).toBe("all");
    expect(fetchRoles).not.toHaveBeenCalled();
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
    expect(fetchChannels).not.toHaveBeenCalled();
  });
});

describe("scheduleSpaceConfigSync", () => {
  it("coalesces a burst into one sync carrying the union", async () => {
    vi.useFakeTimers();
    try {
      const store = storeWith(makeSpace());
      fetchChannels.mockResolvedValue([]);
      fetchRoles.mockResolvedValue([]);
      scheduleSpaceConfigSync("space-1", ["channels"], store.dispatch as never);
      scheduleSpaceConfigSync("space-1", ["roles"], store.dispatch as never);
      scheduleSpaceConfigSync("space-1", ["channels"], store.dispatch as never);
      expect(fetchChannels).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(CONFIG_SYNC_DEBOUNCE_MS + 1);
      expect(fetchChannels).toHaveBeenCalledTimes(1);
      expect(fetchRoles).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
