import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, act, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/__tests__/helpers/renderWithProviders";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => mockNavigate,
}));
vi.mock("@/lib/api/music", () => ({
  browseMusic: vi.fn(),
  browseAlbums: vi.fn(),
  getGenres: vi.fn(),
  resolveMusic: vi.fn(),
}));
vi.mock("@/lib/api/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/client")>()),
  api: vi.fn(),
}));
vi.mock("@/lib/api/discover", () => ({ discoverScenes: vi.fn().mockResolvedValue({ data: [] }) }));
vi.mock("@/lib/nostr/subscriptionManager", () => ({
  subscriptionManager: { subscribeOnce: vi.fn().mockResolvedValue({ reason: "all-eose" }) },
}));
vi.mock("@/lib/nostr/eventPipeline", () => ({
  processIncomingEvent: vi.fn().mockResolvedValue(undefined),
}));
const playQueue = vi.fn();
vi.mock("@/features/music/useAudioPlayer", () => ({
  useAudioPlayer: () => ({ playQueue, play: vi.fn(), player: { currentTrackId: null, isPlaying: false } }),
}));
vi.mock("@/features/profile/useProfile", () => ({ useProfile: () => ({ profile: null }) }));

import { browseMusic, browseAlbums, getGenres, resolveMusic } from "@/lib/api/music";
import { api } from "@/lib/api/client";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { addPlaylists, addTracks } from "@/store/slices/musicSlice";
import { parseTrackEvent } from "@/features/music/trackParser";
import { MusicSegment } from "../MusicSegment";

const mockBrowse = vi.mocked(browseMusic);
const mockAlbums = vi.mocked(browseAlbums);
const mockGenres = vi.mocked(getGenres);
const mockResolve = vi.mocked(resolveMusic);
const mockApi = vi.mocked(api);
const mockOnce = vi.mocked(subscriptionManager.subscribeOnce);

const NOW = Math.floor(Date.now() / 1000);
const PK = "a".repeat(64);

function trackEvent(d: string, title: string, over: { created_at?: number; tags?: string[][] } = {}) {
  return {
    id: `${d}-id`,
    pubkey: PK,
    kind: 31683,
    created_at: over.created_at ?? NOW - 3 * 86_400,
    content: "",
    sig: "s",
    tags: [
      ["d", d],
      ["title", title],
      ["artist", "Some Artist"],
      ["imeta", "url https://x/a.mp3", "m audio/mpeg"],
      ...(over.tags ?? []),
    ],
  };
}

describe("MusicSegment", () => {
  beforeEach(() => {
    mockBrowse.mockReset();
    mockAlbums.mockReset();
    mockGenres.mockReset();
    mockResolve.mockReset();
    mockApi.mockReset();
    mockOnce.mockReset().mockResolvedValue({ reason: "all-eose" });
    playQueue.mockReset();
    mockNavigate.mockReset();
    mockAlbums.mockResolvedValue({ data: { albums: [], total: 0 } });
    mockGenres.mockResolvedValue({ data: [{ genre: "techno", count: 3 }] });
  });

  it("heads the list Trending only when trending actually delivered", async () => {
    mockBrowse.mockImplementation(async ({ sort }) => ({
      data: {
        tracks: sort === "trending" ? [trackEvent("t1", "Hot Track")] : [trackEvent("t2", "New Track")],
        total: 1,
      },
    }));
    renderWithProviders(<MusicSegment query="" />);
    await waitFor(() => expect(screen.getByText("Hot Track")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Trending" })).toBeInTheDocument();
    expect(screen.queryByTestId("sort-disclosure")).not.toBeInTheDocument();
    expect(processIncomingEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "t1-id" }), "browse");
  });

  it("never labels recency Trending: an empty trending set reads Recent with the disclosure", async () => {
    mockBrowse.mockImplementation(async ({ sort }) => ({
      data: { tracks: sort === "trending" ? [] : [trackEvent("t2", "New Track")], total: 1 },
    }));
    renderWithProviders(<MusicSegment query="" />);
    await waitFor(() => expect(screen.getByText("New Track")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Trending" })).not.toBeInTheDocument();
    expect(screen.getByTestId("sort-disclosure")).toHaveTextContent(
      "Recent — not enough signal for trending yet",
    );
  });

  it("prints age-only why-lines and never a play count", async () => {
    mockBrowse.mockResolvedValue({ data: { tracks: [trackEvent("t1", "Aged Track")], total: 1 } });
    const { container } = renderWithProviders(<MusicSegment query="" />);
    await waitFor(() => expect(screen.getByText("Aged Track")).toBeInTheDocument());
    expect(screen.getByTestId("signal-line")).toHaveTextContent("3d");
    expect(container.textContent).not.toMatch(/\bplays?\b/i);
  });

  it("falls back to a relay one-shot when the backend index is unreachable, public tracks only", async () => {
    mockBrowse.mockRejectedValue(new Error("Failed to browse music"));
    mockAlbums.mockRejectedValue(new Error("down"));
    mockGenres.mockRejectedValue(new Error("down"));
    const { store } = renderWithProviders(<MusicSegment query="" />);
    // Simulate the relay events landing in the store through the pipeline.
    act(() => {
      store.dispatch(
        addTracks([
          parseTrackEvent(trackEvent("pub", "Public Track") as never),
          parseTrackEvent(trackEvent("member", "Member Track", { tags: [["h", "space1"]] }) as never),
        ]),
      );
    });
    await waitFor(() => expect(screen.getByText("Public Track")).toBeInTheDocument());
    expect(screen.queryByText("Member Track")).not.toBeInTheDocument();
    expect(mockOnce).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([expect.objectContaining({ kinds: [31683] })]),
      }),
    );
    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
  });

  it("lists only public, non-empty playlists from the one-shot", async () => {
    mockBrowse.mockResolvedValue({ data: { tracks: [trackEvent("t1", "A Track")], total: 1 } });
    const { store } = renderWithProviders(<MusicSegment query="" />);
    act(() => {
      store.dispatch(
        addPlaylists([
          { addressableId: "30119:p:full", eventId: "e1", pubkey: PK, title: "Full Crate", trackRefs: ["31683:p:x"], createdAt: NOW, visibility: "public" },
          { addressableId: "30119:p:empty", eventId: "e2", pubkey: PK, title: "Empty Crate", trackRefs: [], createdAt: NOW, visibility: "public" },
          { addressableId: "30119:p:priv", eventId: "e3", pubkey: PK, title: "Private Crate", trackRefs: ["31683:p:y"], createdAt: NOW, visibility: "private" },
        ]),
      );
    });
    await waitFor(() => expect(screen.getByText("Full Crate")).toBeInTheDocument());
    expect(screen.queryByText("Empty Crate")).not.toBeInTheDocument();
    expect(screen.queryByText("Private Crate")).not.toBeInTheDocument();
    expect(mockOnce).toHaveBeenCalledWith(
      expect.objectContaining({ filters: [{ kinds: [30119], limit: 30 }] }),
    );
  });

  it("search: only the newest request paints, and a track hit resolves before it plays", async () => {
    mockBrowse.mockResolvedValue({ data: { tracks: [], total: 0 } });
    let resolveFirst!: (v: { data: unknown }) => void;
    mockApi
      .mockImplementationOnce(() => new Promise((res) => (resolveFirst = res as (v: { data: unknown }) => void)))
      .mockImplementationOnce(async () => ({
        data: {
          tracks: [{ id: "h", addressable_id: `31683:${PK}:hit`, title: "Hit Track", artist: "A", genre: "", image_url: "", hashtags: [], pubkey: PK, created_at: NOW - 3600 }],
          albums: [{ id: "al", addressable_id: `33123:${PK}:alb`, title: "Hit Album", artist: "A", genre: "", image_url: "", hashtags: [], pubkey: PK, created_at: NOW - 3600 }],
        },
      }));

    const { rerender } = renderWithProviders(<MusicSegment query="ho" />);
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    rerender(<MusicSegment query="hot" />);
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Hit Track")).toBeInTheDocument());
    expect(mockApi).toHaveBeenLastCalledWith("/search/music?q=hot&limit=20", { auth: false });

    // The stale first response lands late and must not paint.
    await act(async () => {
      resolveFirst({ data: { tracks: [{ id: "s", addressable_id: `31683:${PK}:stale`, title: "Stale Track", artist: "A", genre: "", image_url: "", hashtags: [], pubkey: PK, created_at: NOW }], albums: [] } });
    });
    expect(screen.queryByText("Stale Track")).not.toBeInTheDocument();
    expect(screen.getByText("TRACK")).toBeInTheDocument();
    expect(screen.getByText("ALBUM")).toBeInTheDocument();

    // Track hit: resolve the full event first (search docs carry no audio).
    mockResolve.mockResolvedValue({ data: { event: trackEvent("hit", "Hit Track") } });
    fireEvent.click(screen.getByRole("button", { name: "Play Hit Track" }));
    await waitFor(() => expect(playQueue).toHaveBeenCalledWith([`31683:${PK}:hit`], 0));
    expect(mockResolve).toHaveBeenCalledWith("track", PK, "hit");
    expect(processIncomingEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "hit-id" }), "search");
  });

  it("says so when a search hit cannot be resolved", async () => {
    mockBrowse.mockResolvedValue({ data: { tracks: [], total: 0 } });
    mockApi.mockResolvedValue({
      data: {
        tracks: [{ id: "h", addressable_id: `31683:${PK}:gone`, title: "Ghost Track", artist: "A", genre: "", image_url: "", hashtags: [], pubkey: PK, created_at: NOW }],
        albums: [],
      },
    });
    mockResolve.mockRejectedValue(new Error("Not found"));
    renderWithProviders(<MusicSegment query="ghost" />);
    await waitFor(() => expect(screen.getByText("Ghost Track")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Play Ghost Track" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Track unavailable — it may live outside your relays."),
    );
    expect(playQueue).not.toHaveBeenCalled();
  });

  it("opens a genre in the music surface the way MusicHome does", async () => {
    mockBrowse.mockResolvedValue({ data: { tracks: [trackEvent("t1", "A Track")], total: 1 } });
    const { store } = renderWithProviders(<MusicSegment query="" />);
    await waitFor(() => expect(screen.getByRole("button", { name: /techno/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /techno/ }));
    const s = store.getState();
    expect(s.ui.sidebarMode).toBe("music");
    expect(s.music.explore.activeGenre).toBe("techno");
    expect(s.music.activeView).toBe("explore");
    expect(mockNavigate).toHaveBeenCalledWith("/");
  });
});
