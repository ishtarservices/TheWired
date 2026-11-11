import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import type { Space } from "@/types/space";

const can = vi.fn<(permission: string) => boolean>();
vi.mock("../../usePermissions", () => ({ usePermissions: () => ({ can }) }));
vi.mock("../../useRoles", () => ({ useRoles: () => ({ roles: [] }) }));
vi.mock("../../useMemberRoles", () => ({
  useMemberRoles: () => ({ members: [], assignRole: vi.fn(), removeRoleFromMember: vi.fn() }),
}));
vi.mock("../../../profile/useProfile", () => ({ useProfile: () => ({ profile: undefined }) }));
const SEARCH_HIT = "c".repeat(64);
vi.mock("../../../search/useUserSearch", () => ({
  useUserSearch: () => ({
    query: "nova",
    setQuery: vi.fn(),
    results: [{ pubkey: SEARCH_HIT, profile: { name: "nova" } }],
    isSearching: false,
  }),
}));
vi.mock("@/lib/api/spaces", () => ({ addFeedSources: vi.fn(), removeFeedSource: vi.fn() }));
vi.mock("@/lib/db/spaceStore", () => ({ updateSpaceInStore: vi.fn() }));
vi.mock("@/lib/nostr/groupSubscriptions", () => ({ switchSpaceChannel: vi.fn() }));

import * as spacesApi from "@/lib/api/spaces";
import { MembersTab } from "../MembersTab";

const addFeedSources = vi.mocked(spacesApi.addFeedSources);
const SOURCE = "d".repeat(64);
const ADMIN = "b".repeat(64);

function feedSpace(): Space {
  return {
    id: "feed-1",
    name: "Feed",
    hostRelay: "wss://relay.test.com",
    mode: "read",
    isPrivate: false,
    // A non-creator admin: the case the old creator-or-adminPubkeys check and
    // the creator-only backend disagreed on.
    adminPubkeys: [],
    memberPubkeys: [],
    feedPubkeys: [SOURCE],
    creatorPubkey: "a".repeat(64),
    createdAt: 1,
  };
}

function renderTab() {
  return renderWithProviders(<MembersTab spaceId="feed-1" />, {
    preloadedState: {
      spaces: {
        list: [feedSpace()],
        activeSpaceId: null,
        activeChannelId: null,
        subscriptions: {},
        channels: {},
        channelsLoading: {},
        categories: {},
        layoutRevision: {},
        layoutSupported: {},
        pendingInvites: [],
      },
      identity: { pubkey: ADMIN } as never,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MembersTab feed sources", () => {
  it("offers the editor to whoever holds MANAGE_SPACE, creator or not", () => {
    can.mockImplementation((p) => p === "MANAGE_SPACE");
    renderTab();
    expect(screen.getByPlaceholderText("Search users to add...")).toBeTruthy();
    expect(screen.getByTitle("Remove from feed")).toBeTruthy();
  });

  it("hides the editor and the remove buttons without MANAGE_SPACE", () => {
    can.mockReturnValue(false);
    renderTab();
    expect(screen.queryByPlaceholderText("Search users to add...")).toBeNull();
    expect(screen.queryByTitle("Remove from feed")).toBeNull();
    expect(screen.getByText("Feed Sources (1)")).toBeTruthy();
  });

  it("rolls a refused add back and says why instead of reverting silently", async () => {
    can.mockImplementation((p) => p === "MANAGE_SPACE");
    addFeedSources.mockRejectedValue(new Error("Missing MANAGE_SPACE permission"));
    const { store } = renderTab();
    fireEvent.click(screen.getByText("nova"));
    expect(addFeedSources).toHaveBeenCalledWith("feed-1", [SEARCH_HIT]);
    await waitFor(() => expect(screen.getByText("Missing MANAGE_SPACE permission")).toBeTruthy());
    expect(store.getState().spaces.list[0].feedPubkeys).toEqual([SOURCE]);
  });

  it("keeps a successful add", async () => {
    can.mockImplementation((p) => p === "MANAGE_SPACE");
    addFeedSources.mockResolvedValue({ data: [SOURCE, SEARCH_HIT] } as never);
    const { store } = renderTab();
    fireEvent.click(screen.getByText("nova"));
    await waitFor(() => expect(store.getState().spaces.list[0].feedPubkeys).toEqual([SOURCE, SEARCH_HIT]));
    expect(screen.getByText("Feed Sources (2)")).toBeTruthy();
  });
});
