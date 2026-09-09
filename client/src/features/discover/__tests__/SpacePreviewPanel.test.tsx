import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import type { DiscoverSpace } from "@/lib/api/discover";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));
vi.mock("@/lib/api/spaces", () => ({
  joinSpaceApi: vi.fn(),
  getSpace: vi.fn().mockResolvedValue({ data: {} }),
  fetchFeedSources: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("@/lib/nostr/groupSubscriptions", () => ({
  enterAnySpace: vi.fn(),
  leaveAnySpace: vi.fn(),
  switchSpaceChannel: vi.fn(),
  openBgChatSub: vi.fn(),
  enterFriendsFeed: vi.fn(),
  leaveFriendsFeed: vi.fn(),
  switchFriendsFeedChannel: vi.fn(),
}));
vi.mock("@/store/thunks/spaceMembers", () => ({ syncSpaceMembers: () => async () => {} }));
vi.mock("@/lib/db/spaceStore", () => ({
  addSpaceToStore: vi.fn().mockResolvedValue(undefined),
  updateSpaceInStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/lastChannelCache", () => ({
  getLastChannel: vi.fn().mockResolvedValue(null),
  setLastChannel: vi.fn(),
}));
vi.mock("@/lib/api/onboarding", () => ({
  fetchMyOnboardingState: vi.fn().mockResolvedValue({ data: null }),
  fetchOnboardingPreview: vi.fn().mockResolvedValue({ data: null }),
}));

import { joinSpaceApi } from "@/lib/api/spaces";
import { enterAnySpace, switchSpaceChannel } from "@/lib/nostr/groupSubscriptions";
import { login } from "@/store/slices/identitySlice";
import { previewDiscoverSpace } from "@/store/slices/uiSlice";
import { setSpaces } from "@/store/slices/spacesSlice";
import { SpacePreviewPanel } from "../SpacePreviewPanel";

const mockJoin = vi.mocked(joinSpaceApi);
const ME = "e".repeat(64);

function space(over: Partial<DiscoverSpace> = {}): DiscoverSpace {
  return {
    id: "sp1",
    name: "Test Space",
    about: "A test",
    picture: null,
    category: "music",
    hostRelay: "wss://r",
    spaceMode: "platform",
    memberCount: 3,
    activeMembers24h: 2,
    featured: false,
    listed: true,
    tags: ["techno"],
    mode: "read-write",
    language: null,
    messagesLast24h: 0,
    discoveryScore: 0,
    zapCount24h: 0,
    zapSats24h: 0,
    externalOrigin: false,
    creatorPubkey: null,
    listedAt: null,
    createdAt: null,
    ...over,
  };
}

describe("SpacePreviewPanel", () => {
  beforeEach(() => {
    mockJoin.mockReset();
    mockNavigate.mockReset();
    vi.mocked(switchSpaceChannel).mockReset();
    vi.mocked(enterAnySpace).mockReset();
  });

  it("asks for a selection when nothing is previewed", () => {
    renderWithProviders(<SpacePreviewPanel />, { route: "/discover" });
    expect(screen.getByText("Select a space to preview it")).toBeInTheDocument();
  });

  it("shows the same why-line the row prints, plus tags", () => {
    const { store } = renderWithProviders(<SpacePreviewPanel />, { route: "/discover" });
    act(() => {
      store.dispatch(previewDiscoverSpace(space()));
    });
    expect(screen.getByText("Test Space")).toBeInTheDocument();
    expect(screen.getByText("2 active today")).toBeInTheDocument();
    expect(screen.getByText("techno")).toBeInTheDocument();
    expect(screen.queryByText("Feed")).not.toBeInTheDocument();
  });

  it("Join stores channels, activates the default channel, and navigates home", async () => {
    mockJoin.mockResolvedValue({
      data: {
        space: {
          id: "sp1",
          name: "Test",
          mode: "read-write",
          hostRelay: "wss://r",
          creatorPubkey: "pk-c",
          picture: null,
          about: null,
          memberCount: 1,
        },
        channels: [
          { id: "ch-chat", type: "chat", position: 1, isDefault: false },
          { id: "ch-notes", type: "notes", position: 0, isDefault: true },
        ],
        feedPubkeys: [],
      },
    } as never);
    const { store } = renderWithProviders(<SpacePreviewPanel />, { route: "/discover" });
    act(() => {
      store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
      store.dispatch(previewDiscoverSpace(space()));
    });

    fireEvent.click(screen.getByRole("button", { name: "Join Space" }));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
    expect(mockJoin).toHaveBeenCalledWith("sp1");
    const state = store.getState();
    expect(state.spaces.channels.sp1).toHaveLength(2);
    expect(state.spaces.channels.sp1.every((c) => c.feedMode === "all")).toBe(true);
    expect(state.spaces.activeSpaceId).toBe("sp1");
    // Regression guard for the stale-closure workaround: without the manual
    // pick after joinSpace this would be null.
    expect(state.spaces.activeChannelId).toBe("sp1:ch-notes");
    expect(switchSpaceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sp1" }),
      "notes",
      "ch-notes",
    );
    expect(state.ui.sidebarMode).toBe("spaces");
  });

  it("explains an ALREADY_MEMBER rejection", async () => {
    mockJoin.mockRejectedValue({ code: "ALREADY_MEMBER" });
    const { store } = renderWithProviders(<SpacePreviewPanel />, { route: "/discover" });
    act(() => {
      store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
      store.dispatch(previewDiscoverSpace(space()));
    });
    fireEvent.click(screen.getByRole("button", { name: "Join Space" }));
    await waitFor(() =>
      expect(screen.getByText("You're already a member of this space.")).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("Go to Space actually selects the joined space before navigating", async () => {
    const { store } = renderWithProviders(<SpacePreviewPanel />, { route: "/discover" });
    act(() => {
      store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
      store.dispatch(
        setSpaces([
          {
            id: "sp1",
            name: "Test Space",
            hostRelay: "wss://r",
            isPrivate: false,
            adminPubkeys: [],
            memberPubkeys: [ME],
            feedPubkeys: [],
            mode: "read-write",
            creatorPubkey: "pk-c",
            createdAt: 1,
          },
        ]),
      );
      store.dispatch(previewDiscoverSpace(space()));
    });
    fireEvent.click(screen.getByRole("button", { name: "Go to Space" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/"));
    expect(store.getState().spaces.activeSpaceId).toBe("sp1");
    expect(enterAnySpace).toHaveBeenCalled();
  });
});
