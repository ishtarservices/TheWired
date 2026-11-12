import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { musicSlice, setActiveDetailId, setMusicView } from "@/store/slices/musicSlice";
import { uiSlice, setSidebarMode } from "@/store/slices/uiSlice";
import { spacesSlice } from "@/store/slices/spacesSlice";
import { dmSlice } from "@/store/slices/dmSlice";
import { BackLink } from "@/features/music/BackLink";
import {
  describeEntry,
  isMusicDetail,
  originOf,
  previousIndex,
  resetNavigationHistory,
  useNavigationHistory,
  type NavEntry,
} from "../useNavigationHistory";

const entry = (over: Partial<NavEntry> = {}): NavEntry => ({
  route: "/",
  sidebarMode: "music",
  spaceId: null,
  channelId: null,
  musicView: "home",
  musicDetailId: null,
  dmPubkey: null,
  ...over,
});
const project = (id: string) => entry({ musicView: "album-detail", musicDetailId: id });
const artist = (id: string) => entry({ musicView: "artist-detail", musicDetailId: id });

describe("navigation trail rules", () => {
  it("knows a detail page from a section, and music from elsewhere", () => {
    expect(isMusicDetail(project("p"))).toBe(true);
    expect(isMusicDetail(entry({ musicView: "explore" }))).toBe(false);
    // The music view is stale state while another surface is showing.
    expect(isMusicDetail({ ...project("p"), route: "/discover" })).toBe(false);
    expect(isMusicDetail({ ...project("p"), sidebarMode: "spaces" })).toBe(false);
  });

  it("finds the previous page whether or not the current one is recorded yet", () => {
    const explore = entry({ musicView: "explore" });
    const stack = [entry(), explore];
    // Just clicked a project: not recorded yet, so the newest entry is previous.
    expect(previousIndex(stack, 1, project("p"))).toBe(1);
    // Once it has settled into history, previous is the one before it.
    expect(previousIndex([...stack, project("p")], 2, project("p"))).toBe(1);
    expect(previousIndex([], -1, entry())).toBe(-1);
    expect(previousIndex([entry()], 0, entry())).toBe(-1);
  });

  it("traces a detail page back to where the walk started", () => {
    const explore = entry({ musicView: "explore" });
    const stack = [entry(), explore, project("a"), artist("x"), project("b")];
    expect(originOf(stack, 4, project("b"))).toBe(explore);
    // Opened from Discover: the origin is outside the music section.
    const discover = entry({ route: "/discover", sidebarMode: "spaces" });
    expect(originOf([discover, project("a")], 1, project("a"))).toBe(discover);
    // A share link opened first: nothing behind it.
    expect(originOf([project("a")], 0, project("a"))).toBeNull();
  });

  it("names destinations the way the sidebar does", () => {
    expect(describeEntry(entry())).toBe("Home");
    expect(describeEntry(entry({ musicView: "albums" }))).toBe("Projects");
    expect(describeEntry(project("p"))).toBe("project");
    expect(describeEntry(entry({ route: "/discover", sidebarMode: "spaces" }))).toBe("Discover");
    expect(describeEntry(entry({ sidebarMode: "spaces" }))).toBe("Feed");
    expect(describeEntry(entry({ sidebarMode: "spaces", spaceId: "s1" }), "Neon Frequencies")).toBe(
      "Neon Frequencies",
    );
    expect(describeEntry(entry({ route: "/relays" }))).toBeNull();
  });
});

function makeStore() {
  return configureStore({
    reducer: {
      music: musicSlice.reducer,
      ui: uiSlice.reducer,
      spaces: spacesSlice.reducer,
      dm: dmSlice.reducer,
    },
    middleware: (gdm) => gdm({ serializableCheck: false, immutableCheck: false }),
  });
}

/** Stands in for the top bar (records + arrows) and exposes the router. */
function Shell() {
  const { goBack, canGoBack } = useNavigationHistory();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={goBack} disabled={!canGoBack}>
        top-bar back
      </button>
      <button onClick={() => navigate("/discover")}>go discover</button>
      <button onClick={() => navigate("/")}>go index</button>
      <span data-testid="route">{location.pathname}</span>
      <BackLink />
    </>
  );
}

describe("one Back for the top bar and the page", () => {
  const A = `33123:${"a".repeat(64)}:one`;
  const ARTIST = "c".repeat(64);

  beforeEach(() => {
    vi.useFakeTimers();
    resetNavigationHistory();
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
          <Shell />
        </MemoryRouter>
      </Provider>,
    );
    const settle = () =>
      act(() => {
        vi.advanceTimersByTime(400);
      });
    const go = (action: Parameters<typeof store.dispatch>[0]) => {
      act(() => {
        store.dispatch(action);
      });
      settle();
    };
    settle();
    const view = () => {
      const m = store.getState().music;
      return m.activeDetailId ? `${m.activeView}:${m.activeDetailId}` : m.activeView;
    };
    const pageBack = () => screen.getByRole("button", { name: /^Back/ });
    return { store, go, settle, view, pageBack };
  }

  it("walks back through every step to the section it started in, not Home", () => {
    const { go, settle, view, pageBack } = setup();
    go(setMusicView("explore"));
    go(setActiveDetailId({ view: "album-detail", id: A }));
    go(setActiveDetailId({ view: "artist-detail", id: ARTIST }));

    expect(pageBack()).toHaveTextContent("Back to project");
    fireEvent.click(pageBack());
    settle();
    expect(view()).toBe(`album-detail:${A}`);

    expect(pageBack()).toHaveTextContent("Back to Explore");
    fireEvent.click(pageBack());
    settle();
    expect(view()).toBe("explore");
  });

  it("goes to the same place as the top-bar arrow", () => {
    const first = setup();
    first.go(setMusicView("songs"));
    first.go(setActiveDetailId({ view: "album-detail", id: A }));
    fireEvent.click(screen.getByRole("button", { name: "top-bar back" }));
    first.settle();
    const viaTopBar = first.view();
    expect(viaTopBar).toBe("songs");
  });

  it("returns to Discover from a project opened there, not to a stale music page", () => {
    const { store, go, settle, view, pageBack } = setup();
    go(setMusicView("songs")); // the music page left open earlier
    act(() => {
      store.dispatch(setSidebarMode("spaces"));
    });
    fireEvent.click(screen.getByRole("button", { name: "go discover" }));
    settle();

    // What Discover does when a project is clicked.
    act(() => {
      store.dispatch(setSidebarMode("music"));
      store.dispatch(setActiveDetailId({ view: "album-detail", id: A }));
    });
    fireEvent.click(screen.getByRole("button", { name: "go index" }));
    settle();
    expect(view()).toBe(`album-detail:${A}`);

    expect(pageBack()).toHaveTextContent("Back to Discover");
    fireEvent.click(pageBack());
    settle();
    expect(screen.getByTestId("route")).toHaveTextContent("/discover");
    expect(store.getState().ui.sidebarMode).toBe("spaces");
  });

  it("steps out to the music section when nothing is behind the page", () => {
    const store = makeStore();
    store.dispatch(setSidebarMode("music"));
    store.dispatch(setActiveDetailId({ view: "album-detail", id: A }));
    render(
      <Provider store={store}>
        <MemoryRouter>
          <BackLink />
        </MemoryRouter>
      </Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(store.getState().music.activeView).toBe("home");
    expect(store.getState().music.activeDetailId).toBeNull();
  });
});
