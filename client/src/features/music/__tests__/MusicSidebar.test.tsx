import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { identitySlice } from "@/store/slices/identitySlice";
import { musicSlice, setActiveDetailId, setMusicView } from "@/store/slices/musicSlice";
import { uiSlice, setSidebarMode } from "@/store/slices/uiSlice";
import { spacesSlice } from "@/store/slices/spacesSlice";
import { dmSlice } from "@/store/slices/dmSlice";
import { resetNavigationHistory, useNavigationHistory } from "@/hooks/useNavigationHistory";
import {
  featuresSlice,
  setFeatureEnabled,
  FEATURE_MUSIC_INSIGHTS,
} from "@/store/slices/featuresSlice";

const listenGroups = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("../useListenRequests", () => ({
  useIncomingListenRequests: () => ({
    groups: listenGroups.current,
    loading: false,
    error: null,
    refresh: () => {},
  }),
}));

import { MusicSidebar } from "../MusicSidebar";

function makeStore() {
  const store = configureStore({
    reducer: {
      identity: identitySlice.reducer,
      music: musicSlice.reducer,
      features: featuresSlice.reducer,
      ui: uiSlice.reducer,
      spaces: spacesSlice.reducer,
      dm: dmSlice.reducer,
    },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
  store.dispatch(identitySlice.actions.login({ pubkey: "a".repeat(64), signerType: "nip07" }));
  return store;
}

function renderSidebar(store = makeStore()) {
  render(
    <Provider store={store}>
      <MemoryRouter>
        <MusicSidebar />
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe("MusicSidebar optional entries", () => {
  beforeEach(() => {
    listenGroups.current = [];
  });

  it("hides Insights until the feature is switched on", () => {
    renderSidebar();
    expect(screen.queryByText("Insights")).toBeNull();
    expect(screen.getByText("Projects")).toBeTruthy();
  });

  it("shows Insights when Music Insights is enabled", () => {
    const store = makeStore();
    store.dispatch(setFeatureEnabled({ feature: FEATURE_MUSIC_INSIGHTS, enabled: true }));
    renderSidebar(store);
    expect(screen.getByText("Insights")).toBeTruthy();
  });

  it("hides Listen Requests while nobody has asked", () => {
    renderSidebar();
    expect(screen.queryByText("Listen Requests")).toBeNull();
  });

  it("shows Listen Requests with a count once there are some", () => {
    listenGroups.current = [{}, {}];
    renderSidebar();
    expect(screen.getByText("Listen Requests")).toBeTruthy();
    expect(screen.getByLabelText("2 open listen requests")).toBeTruthy();
  });

  it("keeps Listen Requests listed while that page is open, even when empty", () => {
    const store = makeStore();
    store.dispatch(setMusicView("listen-requests"));
    renderSidebar(store);
    expect(screen.getByText("Listen Requests")).toBeTruthy();
  });
});

/** The top bar is what records history in the app; stand in for it. */
function Recorder() {
  useNavigationHistory();
  return null;
}

describe("MusicSidebar keeps the section you came from marked", () => {
  const PROJECT = `33123:${"b".repeat(64)}:lp`;
  const ARTIST = "c".repeat(64);

  beforeEach(() => {
    vi.useFakeTimers();
    resetNavigationHistory();
    listenGroups.current = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const store = makeStore();
    store.dispatch(setSidebarMode("music"));
    render(
      <Provider store={store}>
        <MemoryRouter>
          <Recorder />
          <MusicSidebar />
        </MemoryRouter>
      </Provider>,
    );
    // Let the page we start on settle into history.
    const go = (action: Parameters<typeof store.dispatch>[0]) =>
      act(() => {
        store.dispatch(action);
        vi.advanceTimersByTime(200);
      });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    return { store, go };
  }

  const marked = () =>
    screen
      .getAllByRole("button")
      .filter((b) => b.className.includes("bg-surface-hover"))
      .map((b) => b.textContent);

  it("stays on Home when a project is opened from Home", () => {
    const { go } = setup();
    expect(marked()).toEqual(["Home"]);
    go(setActiveDetailId({ view: "album-detail", id: PROJECT }));
    expect(marked()).toEqual(["Home"]);
  });

  it("stays on Explore through project → artist → project", () => {
    const { go } = setup();
    go(setMusicView("explore"));
    go(setActiveDetailId({ view: "album-detail", id: PROJECT }));
    go(setActiveDetailId({ view: "artist-detail", id: ARTIST }));
    go(setActiveDetailId({ view: "album-detail", id: `33123:${ARTIST}:other` }));
    expect(marked()).toEqual(["Explore"]);
  });

  it("marks Projects only when the project was opened from the Projects list", () => {
    const { go } = setup();
    go(setMusicView("albums"));
    go(setActiveDetailId({ view: "album-detail", id: PROJECT }));
    expect(marked()).toEqual(["Projects"]);
  });

  it("marks nothing for a project opened from outside the music section", () => {
    const { store, go } = setup();
    go(setSidebarMode("spaces")); // e.g. the feed, or Discover
    act(() => {
      store.dispatch(setSidebarMode("music"));
      store.dispatch(setActiveDetailId({ view: "album-detail", id: PROJECT }));
      vi.advanceTimersByTime(200);
    });
    expect(marked()).toEqual([]);
  });
});
