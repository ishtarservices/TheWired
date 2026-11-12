import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { configureStore } from "@reduxjs/toolkit";
import { identitySlice } from "@/store/slices/identitySlice";
import { musicSlice, setMusicView } from "@/store/slices/musicSlice";
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
