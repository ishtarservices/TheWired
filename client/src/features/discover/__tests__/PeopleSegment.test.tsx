import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import type { PersonHit } from "@/lib/api/people";

vi.mock("@/lib/api/people", () => ({ searchPeople: vi.fn() }));
vi.mock("@/lib/nostr/profileCache", () => ({ profileCache: { warmPubkeys: vi.fn() } }));
vi.mock("@/lib/nostr/follow", () => ({ followUser: vi.fn(), unfollowUser: vi.fn() }));
vi.mock("@/lib/nostr/friendRequest", () => ({
  wouldBreakFriendship: () => false,
  removeFriendAction: vi.fn(),
}));
const localSearch = { query: "", setQuery: vi.fn(), results: [] as { pubkey: string; profile: Record<string, string> }[], isSearching: false };
vi.mock("@/features/search/useUserSearch", () => ({ useUserSearch: () => localSearch }));

import { searchPeople } from "@/lib/api/people";
import { followUser } from "@/lib/nostr/follow";
import { profileCache } from "@/lib/nostr/profileCache";
import { login, setFollowList } from "@/store/slices/identitySlice";
import { PeopleSegment } from "../PeopleSegment";

const mockPeople = vi.mocked(searchPeople);
const PK = (c: string) => c.repeat(64);

function hit(over: Partial<PersonHit> = {}): PersonHit {
  return {
    pubkey: PK("a"),
    name: "Gothic Monk",
    displayName: "Gothic Monk",
    nip05: "gothicmonk@thewired.app",
    about: "Biochemical -9",
    picture: null,
    noteCount: 0,
    hasNip05: true,
    ...over,
  };
}

describe("PeopleSegment", () => {
  beforeEach(() => {
    mockPeople.mockReset();
    localSearch.results = [];
    vi.mocked(followUser).mockReset();
  });

  it("browses verified handles and labels the list as what it is", async () => {
    mockPeople.mockResolvedValue({ data: [hit()] });
    renderWithProviders(<PeopleSegment query="" />);
    await waitFor(() => expect(screen.getByText("Gothic Monk")).toBeInTheDocument());
    expect(mockPeople).toHaveBeenCalledWith({ hasNip05: true, limit: 30 });
    expect(screen.getByText("With handles")).toBeInTheDocument();
    // The header said it — no per-row verification mark in browse.
    expect(screen.queryByTestId("verifier")).not.toBeInTheDocument();
    // Hydrates kind-0s so the profile page opens warm.
    expect(profileCache.warmPubkeys).toHaveBeenCalledWith([PK("a")]);
  });

  it("shows the bio instead of a handle that just repeats the name, and no why-line at zero notes", async () => {
    mockPeople.mockResolvedValue({ data: [hit()] });
    renderWithProviders(<PeopleSegment query="" />);
    await waitFor(() => expect(screen.getByText("Biochemical -9")).toBeInTheDocument());
    expect(screen.queryByText(/gothicmonk/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("signal-line")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 notes/)).not.toBeInTheDocument();
  });

  it("keeps a handle that differs from the name, and prints activity when there is some", async () => {
    mockPeople.mockResolvedValue({
      data: [hit({ name: "Marcus Cole", displayName: "Marcus Cole", nip05: "dj_sludge@thewired.app", noteCount: 12 })],
    });
    renderWithProviders(<PeopleSegment query="" />);
    await waitFor(() => expect(screen.getByText("dj_sludge")).toBeInTheDocument());
    expect(screen.queryByText("Biochemical -9")).not.toBeInTheDocument(); // handle OR bio, never both
    expect(screen.getByText("12 notes · 30d")).toBeInTheDocument();
  });

  it("searches without the nip05 filter and marks verifiers only where the handle line lacks one", async () => {
    mockPeople.mockResolvedValue({
      data: [
        hit({ pubkey: PK("a") }), // handle dropped → domain vouches
        hit({ pubkey: PK("b"), name: "Aria", displayName: "Aria", nip05: "aria@elsewhere.xyz" }), // full address printed
        hit({ pubkey: PK("c"), name: "Nobody", displayName: "Nobody", nip05: null, hasNip05: false }),
      ],
    });
    renderWithProviders(<PeopleSegment query="ar" />);
    await waitFor(() => expect(screen.getByText("Aria")).toBeInTheDocument());
    expect(mockPeople).toHaveBeenCalledWith({ q: "ar", limit: 30 });
    expect(screen.getAllByTestId("verifier")).toHaveLength(1);
    expect(screen.getByTestId("verifier")).toHaveTextContent("thewired.app");
    expect(screen.queryByText("With handles")).not.toBeInTheDocument();
  });

  it("merges local/relay results the index missed, server rows first", async () => {
    mockPeople.mockResolvedValue({ data: [hit({ pubkey: PK("a") })] });
    localSearch.results = [
      { pubkey: PK("a"), profile: { name: "dupe" } },
      { pubkey: PK("d"), profile: { name: "Relay Only", nip05: "relay@else.where" } },
    ];
    renderWithProviders(<PeopleSegment query="go" />);
    // Local rows paint instantly; the server answer lands after the debounce.
    await waitFor(() => expect(screen.getByText("Gothic Monk")).toBeInTheDocument());
    expect(screen.getByText("Relay Only")).toBeInTheDocument();
    const names = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names.findIndex((t) => t.includes("Gothic Monk"))).toBeLessThan(
      names.findIndex((t) => t.includes("Relay Only")),
    );
    expect(screen.getAllByText("Gothic Monk")).toHaveLength(1);
  });

  it("uses a quiet text follow control gated on the loaded follow list", async () => {
    mockPeople.mockResolvedValue({ data: [hit()] });
    const { store } = renderWithProviders(<PeopleSegment query="" />);
    act(() => {
      store.dispatch(login({ pubkey: PK("e"), signerType: "nip07" }));
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Follow" })).toBeDisabled(); // list not loaded yet
    act(() => {
      store.dispatch(setFollowList({ follows: [PK("f")], createdAt: 1 }));
    });
    expect(screen.getByRole("button", { name: "Follow" })).toBeEnabled();
    screen.getByRole("button", { name: "Follow" }).click();
    await waitFor(() => expect(followUser).toHaveBeenCalledWith(PK("a")));
  });

  it("degrades to an honest empty state when the endpoint fails", async () => {
    mockPeople.mockRejectedValue(new Error("boom"));
    renderWithProviders(<PeopleSegment query="" />);
    await waitFor(() => expect(screen.getByText("No one to show yet")).toBeInTheDocument());
    expect(screen.queryByText("With handles")).not.toBeInTheDocument();
  });

  it("offers the npub hint on an empty search", async () => {
    mockPeople.mockResolvedValue({ data: [] });
    renderWithProviders(<PeopleSegment query="zzz" />);
    await waitFor(() => expect(screen.getByText("No one found")).toBeInTheDocument());
    expect(screen.getByText(/paste an npub/)).toBeInTheDocument();
  });
});
