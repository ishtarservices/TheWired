import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { createTestStore } from "@/__tests__/helpers/createTestStore";
import { setActivePubkey } from "@/lib/db/userStateStore";
import { getDB } from "@/lib/db/database";
import { saveMembers, loadMembers } from "@/lib/db/spaceMembersStore";
import type { Space, SpaceMember, SpaceRole } from "@/types/space";

vi.mock("@/lib/api/roles", () => ({
  fetchAllMemberRoles: vi.fn(),
}));

import * as rolesApi from "@/lib/api/roles";
import { syncSpaceMembers, _resetInFlight } from "../spaceMembers";

const mockFetch = rolesApi.fetchAllMemberRoles as ReturnType<typeof vi.fn>;

function makeRole(overrides: Partial<SpaceRole> = {}): SpaceRole {
  return {
    id: "role-default",
    spaceId: "space-1",
    name: "Member",
    position: 100,
    isDefault: true,
    isAdmin: false,
    permissions: [],
    ...overrides,
  };
}

function makeMember(overrides: Partial<SpaceMember> = {}): SpaceMember {
  return { pubkey: "pk-1", roles: [], joinedAt: 1_000_000, ...overrides };
}

function makeSpace(overrides: Partial<Space> = {}): Space {
  return {
    id: "space-1",
    name: "Test Space",
    hostRelay: "wss://relay.test.com",
    mode: "read-write",
    isPrivate: false,
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [],
    creatorPubkey: "a".repeat(64),
    createdAt: 1_000_000,
    ...overrides,
  };
}

beforeEach(async () => {
  const db = await getDB();
  await db.clear("user_state");
  setActivePubkey(null);
  mockFetch.mockReset();
  _resetInFlight();
});

describe("syncSpaceMembers thunk", () => {
  it("writes both spaceConfig.members and spaces.list[*].memberPubkeys atomically", async () => {
    const store = createTestStore({
      spaces: {
        list: [makeSpace()],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
    });

    const member = makeMember({
      pubkey: "pk-admin",
      roles: [makeRole({ id: "admin", name: "Admin", position: 1, isAdmin: true })],
    });
    mockFetch.mockResolvedValue([member]);

    await store.dispatch(syncSpaceMembers("space-1"));

    expect(store.getState().spaceConfig.members["space-1"]).toEqual([member]);
    expect(store.getState().spaces.list[0].memberPubkeys).toEqual(["pk-admin"]);
  });

  it("persists to IndexedDB on successful fetch", async () => {
    const store = createTestStore({
      spaces: {
        list: [makeSpace()],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
    });

    mockFetch.mockResolvedValue([makeMember({ pubkey: "pk-a" })]);
    await store.dispatch(syncSpaceMembers("space-1"));

    const persisted = await loadMembers("space-1");
    expect(persisted).toHaveLength(1);
    expect(persisted?.[0].pubkey).toBe("pk-a");
  });

  it("dedupes concurrent calls for the same spaceId (in-flight cache)", async () => {
    const store = createTestStore();

    let resolveFn: (val: SpaceMember[]) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise<SpaceMember[]>((resolve) => {
        resolveFn = resolve;
      }),
    );

    const p1 = store.dispatch(syncSpaceMembers("space-1"));
    const p2 = store.dispatch(syncSpaceMembers("space-1"));
    const p3 = store.dispatch(syncSpaceMembers("space-1"));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolveFn([makeMember({ pubkey: "pk-a" })]);
    await Promise.all([p1, p2, p3]);
  });

  it("does not overwrite existing state when backend returns empty list", async () => {
    const existingMember = makeMember({ pubkey: "pk-existing" });
    const store = createTestStore({
      spaces: {
        list: [makeSpace({ memberPubkeys: ["pk-existing"] })],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
      spaceConfig: {
        roles: {},
        members: { "space-1": [existingMember] },
        overrides: {},
        myPermissions: {},
        myChannelOverrides: {},
        bans: {},
        mutes: {},
        onboardingPending: {},
        loading: {},
      },
    });

    mockFetch.mockResolvedValue([]);
    await store.dispatch(syncSpaceMembers("space-1"));

    expect(store.getState().spaceConfig.members["space-1"]).toEqual([existingMember]);
    expect(store.getState().spaces.list[0].memberPubkeys).toEqual(["pk-existing"]);
  });

  it("falls back gracefully on backend error (keeps existing state)", async () => {
    const existingMember = makeMember({ pubkey: "pk-existing" });
    const store = createTestStore({
      spaces: {
        list: [makeSpace({ memberPubkeys: ["pk-existing"] })],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
      spaceConfig: {
        roles: {},
        members: { "space-1": [existingMember] },
        overrides: {},
        myPermissions: {},
        myChannelOverrides: {},
        bans: {},
        mutes: {},
        onboardingPending: {},
        loading: {},
      },
    });

    mockFetch.mockRejectedValue(new Error("network down"));
    await store.dispatch(syncSpaceMembers("space-1"));

    expect(store.getState().spaceConfig.members["space-1"]).toEqual([existingMember]);
    expect(store.getState().spaces.list[0].memberPubkeys).toEqual(["pk-existing"]);
  });

  it("releases in-flight slot after completion (allows refetch)", async () => {
    const store = createTestStore();

    mockFetch.mockResolvedValue([makeMember({ pubkey: "pk-a" })]);
    await store.dispatch(syncSpaceMembers("space-1"));

    mockFetch.mockResolvedValue([makeMember({ pubkey: "pk-b" })]);
    await store.dispatch(syncSpaceMembers("space-1"));

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("seeded with IndexedDB data: replaces with fetched authoritative list", async () => {
    await saveMembers("space-1", [makeMember({ pubkey: "pk-stale" })]);

    const store = createTestStore({
      spaces: {
        list: [makeSpace({ memberPubkeys: ["pk-stale"] })],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
    });

    mockFetch.mockResolvedValue([makeMember({ pubkey: "pk-fresh" })]);
    await store.dispatch(syncSpaceMembers("space-1"));

    expect(store.getState().spaces.list[0].memberPubkeys).toEqual(["pk-fresh"]);
    const persisted = await loadMembers("space-1");
    expect(persisted?.[0].pubkey).toBe("pk-fresh");
  });
});
