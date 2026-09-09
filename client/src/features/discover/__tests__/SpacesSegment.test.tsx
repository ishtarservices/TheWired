import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";
import type { DiscoverSpace, SpaceCategory } from "@/lib/api/discover";

vi.mock("@/lib/api/discover", () => ({
  discoverSpaces: vi.fn(),
  getDiscoverCategories: vi.fn(),
  discoverScenes: vi.fn(),
}));

import { discoverSpaces, getDiscoverCategories, discoverScenes } from "@/lib/api/discover";
import { resetCategoriesCache } from "../useCategories";
import { resetScenesCache } from "../useScenes";
import { SpacesSegment } from "../SpacesSegment";

const mockSpaces = vi.mocked(discoverSpaces);
const mockCategories = vi.mocked(getDiscoverCategories);
const mockScenes = vi.mocked(discoverScenes);

function space(over: Partial<DiscoverSpace> = {}): DiscoverSpace {
  return {
    id: "s1",
    name: "Space One",
    about: null,
    picture: null,
    category: null,
    hostRelay: null,
    spaceMode: "platform",
    memberCount: 4,
    activeMembers24h: 0,
    featured: false,
    listed: true,
    tags: [],
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

function cat(slug: string, spaceCount: number, position = 0): SpaceCategory {
  return { slug, name: slug.toUpperCase(), spaceCount, icon: "Gamepad2", description: null, position };
}

/** A promise we resolve by hand, to order responses in tests. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SpacesSegment", () => {
  beforeEach(() => {
    mockSpaces.mockReset();
    mockCategories.mockReset();
    mockScenes.mockReset();
    resetCategoriesCache();
    resetScenesCache();
    mockScenes.mockResolvedValue({ data: [] });
  });

  it("paints skeletons on first render, never an empty page", () => {
    mockSpaces.mockReturnValue(new Promise(() => {}));
    mockCategories.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<SpacesSegment query="" />);
    expect(screen.getByTestId("row-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("tile-skeleton")).toBeInTheDocument();
  });

  it("offers a scene chip only once the loaded corpus backs it (server scenes never answered)", async () => {
    mockCategories.mockResolvedValue({ data: [] });
    mockSpaces.mockResolvedValue({ data: [space({ tags: ["techno"] })] });
    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(screen.getByRole("group", { name: "Scenes" })).toBeInTheDocument());
    // The bundled fallback vocabulary matched "techno" → Club; nothing else
    // has anything behind it, so nothing else is offered.
    expect(screen.getByRole("button", { name: "Club" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vapor" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Club" }));
    await waitFor(() =>
      expect(mockSpaces).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: expect.arrayContaining(["techno", "club", "rave"]) }),
      ),
    );
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("renders the busiest six tiles with a way to see the rest, and never a dead toggle", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => cat(`c${i}`, 8 - i, i));
    mockCategories.mockResolvedValue({ data: eight });
    mockSpaces.mockResolvedValue({ data: [space()] });
    renderWithProviders(<SpacesSegment query="" />);

    await waitFor(() => expect(screen.getByTestId("category-grid")).toBeInTheDocument());
    expect(screen.getByTestId("category-grid").querySelectorAll("button")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "All categories" }));
    expect(screen.getByTestId("category-grid").querySelectorAll("button")).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Fewer categories" })).toBeInTheDocument();
  });

  it("drops the browse grid when no category has spaces, and hides zero-count tiles", async () => {
    mockCategories.mockResolvedValue({ data: [cat("empty", 0), cat("quiet", 0)] });
    mockSpaces.mockResolvedValue({ data: [space()] });
    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(screen.getByText("Space One")).toBeInTheDocument());
    expect(screen.queryByTestId("category-grid")).not.toBeInTheDocument();
    expect(screen.queryByText("Browse")).not.toBeInTheDocument();
  });

  it("filters on a tile click, swaps the grid for the category chip row and heads the list Results", async () => {
    mockCategories.mockResolvedValue({ data: [cat("music", 3), cat("art", 1)] });
    mockSpaces.mockResolvedValue({ data: [space()] });
    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(screen.getByTestId("category-grid")).toBeInTheDocument());
    expect(screen.getByText("All spaces")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^MUSIC,/ }));

    await waitFor(() =>
      expect(mockSpaces).toHaveBeenLastCalledWith(expect.objectContaining({ category: "music" })),
    );
    expect(screen.queryByTestId("category-grid")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Categories" })).toBeInTheDocument();
    expect(screen.getByText("Results")).toBeInTheDocument();
  });

  it("defaults to the Zapped sort and asks the backend for trending", async () => {
    mockCategories.mockResolvedValue({ data: [] });
    mockSpaces.mockResolvedValue({ data: [] });
    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(mockSpaces).toHaveBeenCalled());
    expect(mockSpaces).toHaveBeenCalledWith(expect.objectContaining({ sort: "trending", limit: 25 }));
    expect(screen.getByRole("button", { name: "Zapped" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets only the newest in-flight request paint", async () => {
    mockCategories.mockResolvedValue({ data: [] });
    const first = deferred<{ data: DiscoverSpace[] }>();
    const second = deferred<{ data: DiscoverSpace[] }>();
    mockSpaces.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(mockSpaces).toHaveBeenCalledTimes(1));

    // Switch sort while the first request is still in flight.
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    await waitFor(() => expect(mockSpaces).toHaveBeenCalledTimes(2));

    // Newest resolves first, then the stale one lands late.
    await act(async () => {
      second.resolve({ data: [space({ id: "fresh", name: "Fresh Result" })] });
    });
    await act(async () => {
      first.resolve({ data: [space({ id: "stale", name: "Stale Result" })] });
    });

    expect(screen.getByText("Fresh Result")).toBeInTheDocument();
    expect(screen.queryByText("Stale Result")).not.toBeInTheDocument();
  });

  it("shows every row's why-line, and nothing where there is no signal", async () => {
    mockCategories.mockResolvedValue({ data: [] });
    mockSpaces.mockResolvedValue({
      data: [
        space({ id: "a", name: "Funded", zapCount24h: 3, zapSats24h: 12400 }),
        space({ id: "b", name: "Quiet", memberCount: 99, category: "music" }),
      ],
    });
    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(screen.getByText("Funded")).toBeInTheDocument());
    expect(screen.getByText("3 zaps · 12.4k sats today")).toBeInTheDocument();
    // "Quiet" has member count and a category, which the row already prints;
    // it earns no why-line rather than an invented one.
    expect(screen.getAllByTestId("signal-line")).toHaveLength(1);
    expect(screen.queryByText(/active/)).not.toBeInTheDocument();
  });

  it("badges Feed only for read mode", async () => {
    mockCategories.mockResolvedValue({ data: [] });
    mockSpaces.mockResolvedValue({
      data: [space({ id: "a", name: "Feed Space", mode: "read" }), space({ id: "b", name: "Chat Space" })],
    });
    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(screen.getByText("Feed Space")).toBeInTheDocument());
    expect(screen.getAllByText("Feed")).toHaveLength(1);
  });

  it("selects a row into the right-panel preview", async () => {
    mockCategories.mockResolvedValue({ data: [] });
    mockSpaces.mockResolvedValue({ data: [space({ id: "pick", name: "Pick Me" })] });
    const { store } = renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(screen.getByText("Pick Me")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Pick Me/ }));
    expect(store.getState().ui.discoverPreviewSpace?.id).toBe("pick");
    expect(store.getState().ui.rightPanel.openByContext.discover).toBe(true);
    expect(screen.getByRole("button", { name: /Pick Me/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("surfaces a directory failure honestly with a retry", async () => {
    mockCategories.mockResolvedValue({ data: [] });
    mockSpaces.mockRejectedValueOnce(new Error("Directory unavailable (503)"));
    mockSpaces.mockResolvedValueOnce({ data: [space({ name: "Back Online" })] });
    renderWithProviders(<SpacesSegment query="" />);
    await waitFor(() => expect(screen.getByText("Directory unavailable")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Back Online")).toBeInTheDocument());
  });
});
