import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { renderHook, act } from "@testing-library/react";
import { Provider } from "react-redux";
import { createElement, type ReactNode } from "react";
import { createTestStore, type TestStore } from "@/__tests__/helpers/createTestStore";
import { setActivePubkey } from "@/lib/db/userStateStore";
import { getDB } from "@/lib/db/database";
import { loadMembers } from "@/lib/db/spaceMembersStore";
import type { Space, SpaceMember } from "@/types/space";

vi.mock("@/lib/api/moderation", () => ({
  fetchBans: vi.fn().mockResolvedValue([]),
  fetchMutes: vi.fn().mockResolvedValue([]),
  banMember: vi.fn(),
  unbanMember: vi.fn(),
  muteMember: vi.fn(),
  unmuteMember: vi.fn(),
  kickMember: vi.fn(),
}));

vi.mock("@/lib/api/roles", () => ({
  fetchAllMemberRoles: vi.fn().mockResolvedValue([]),
}));

import * as moderationApi from "@/lib/api/moderation";
import { useModeration } from "../useModeration";
import { _resetInFlight } from "@/store/thunks/spaceMembers";

const mockKick = moderationApi.kickMember as ReturnType<typeof vi.fn>;
const mockBan = moderationApi.banMember as ReturnType<typeof vi.fn>;

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

function wrapper(store: TestStore) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ProviderAny = Provider as any;
  return ({ children }: { children: ReactNode }) =>
    createElement(ProviderAny, { store }, children);
}

beforeEach(async () => {
  const db = await getDB();
  await db.clear("user_state");
  setActivePubkey(null);
  _resetInFlight();
  vi.clearAllMocks();
  mockKick.mockResolvedValue(undefined);
  mockBan.mockResolvedValue({
    id: "ban-1",
    spaceId: "space-1",
    pubkey: "pk-victim",
    bannedBy: "pk-admin",
    createdAt: new Date().toISOString(),
  });
});

describe("useModeration kick/ban dual-write", () => {
  it("kickMember removes from BOTH spaces.memberPubkeys AND spaceConfig.members AND IDB", async () => {
    const store = createTestStore({
      spaces: {
        list: [makeSpace({ memberPubkeys: ["pk-admin", "pk-victim"] })],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
      spaceConfig: {
        roles: {},
        members: {
          "space-1": [
            makeMember({ pubkey: "pk-admin" }),
            makeMember({ pubkey: "pk-victim" }),
          ],
        },
        overrides: {},
        myPermissions: {},
        myChannelOverrides: {},
        bans: {},
        mutes: {},
        onboardingPending: {},
        loading: {},
      },
    });

    const { result } = renderHook(() => useModeration("space-1", false), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.kickMember("pk-victim");
    });

    const state = store.getState();
    expect(state.spaces.list[0].memberPubkeys).toEqual(["pk-admin"]);
    expect(state.spaceConfig.members["space-1"].map((m) => m.pubkey)).toEqual(["pk-admin"]);
  });

  it("banMember also dual-writes (kicked + banned in same flow)", async () => {
    const store = createTestStore({
      spaces: {
        list: [makeSpace({ memberPubkeys: ["pk-admin", "pk-victim"] })],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
      spaceConfig: {
        roles: {},
        members: {
          "space-1": [
            makeMember({ pubkey: "pk-admin" }),
            makeMember({ pubkey: "pk-victim" }),
          ],
        },
        overrides: {},
        myPermissions: {},
        myChannelOverrides: {},
        bans: {},
        mutes: {},
        onboardingPending: {},
        loading: {},
      },
    });

    const { result } = renderHook(() => useModeration("space-1", false), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.banMember("pk-victim", "spam");
    });

    const state = store.getState();
    expect(state.spaces.list[0].memberPubkeys).toEqual(["pk-admin"]);
    expect(state.spaceConfig.members["space-1"].map((m) => m.pubkey)).toEqual(["pk-admin"]);
    expect(state.spaceConfig.bans["space-1"]).toHaveLength(1);
  });

  it("kickMember persists the filtered roster to IndexedDB (write-through)", async () => {
    const store = createTestStore({
      spaces: {
        list: [makeSpace({ memberPubkeys: ["pk-admin", "pk-victim"] })],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        pendingInvites: [],
      },
      spaceConfig: {
        roles: {},
        members: {
          "space-1": [
            makeMember({ pubkey: "pk-admin" }),
            makeMember({ pubkey: "pk-victim" }),
          ],
        },
        overrides: {},
        myPermissions: {},
        myChannelOverrides: {},
        bans: {},
        mutes: {},
        onboardingPending: {},
        loading: {},
      },
    });

    const { result } = renderHook(() => useModeration("space-1", false), {
      wrapper: wrapper(store),
    });

    await act(async () => {
      await result.current.kickMember("pk-victim");
    });

    // Wait a tick for the best-effort IDB write to flush
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const persisted = await loadMembers("space-1");
    expect(persisted?.map((m) => m.pubkey)).toEqual(["pk-admin"]);
  });
});
