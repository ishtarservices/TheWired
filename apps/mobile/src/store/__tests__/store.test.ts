import { createStore, type ThunkExtra } from "../index";
import { setIdentity, setLoggedOut } from "../slices/identitySlice";
import {
  appBackgrounded,
  appForegrounded,
  setOnline,
} from "../slices/lifecycleSlice";
import { selectAnyRelayConnected, setRelayStatus } from "../slices/relaysSlice";
import type { PlatformAdapters } from "@/core/adapters";

// The factory only threads adapters through — a bare object exercises the
// wiring without pulling in Expo native modules.
function fakeAdapters(): PlatformAdapters {
  return { marker: "fake" } as unknown as PlatformAdapters;
}

describe("createStore(adapters)", () => {
  it("builds a store with the stub slices at their initial state", () => {
    const store = createStore(fakeAdapters());
    const state = store.getState();

    expect(state.identity).toEqual({
      status: "hydrating",
      pubkey: null,
      signerType: null,
    });
    expect(state.relays).toEqual({ statuses: {} });
    expect(state.lifecycle).toEqual({
      appState: "active",
      isOnline: true,
      lastForegroundAt: null,
    });
  });

  it("exposes the adapters to thunks as the extra argument", async () => {
    const adapters = fakeAdapters();
    const store = createStore(adapters);

    const seen = await store.dispatch(
      (_dispatch, _getState, extra) => (extra as ThunkExtra).adapters,
    );
    expect(seen).toBe(adapters);
  });

  it("reduces identity actions", () => {
    const store = createStore(fakeAdapters());
    store.dispatch(setIdentity({ pubkey: "abc", signerType: "nip46" }));
    expect(store.getState().identity).toEqual({
      status: "loggedIn",
      pubkey: "abc",
      signerType: "nip46",
    });

    store.dispatch(setLoggedOut());
    expect(store.getState().identity.status).toBe("loggedOut");
    expect(store.getState().identity.pubkey).toBeNull();
  });

  it("reduces relay status updates", () => {
    const store = createStore(fakeAdapters());
    store.dispatch(setRelayStatus({ url: "wss://relay.thewired.app", status: "connected" }));
    expect(store.getState().relays.statuses["wss://relay.thewired.app"]).toBe("connected");
  });

  it("reports connectivity evidence only while some relay is connected", () => {
    const store = createStore(fakeAdapters());
    expect(selectAnyRelayConnected(store.getState())).toBe(false);

    store.dispatch(setRelayStatus({ url: "wss://a", status: "connecting" }));
    expect(selectAnyRelayConnected(store.getState())).toBe(false);

    store.dispatch(setRelayStatus({ url: "wss://b", status: "connected" }));
    expect(selectAnyRelayConnected(store.getState())).toBe(true);

    store.dispatch(setRelayStatus({ url: "wss://b", status: "disconnected" }));
    expect(selectAnyRelayConnected(store.getState())).toBe(false);
  });

  it("tracks lifecycle transitions", () => {
    const store = createStore(fakeAdapters());

    store.dispatch(appBackgrounded());
    expect(store.getState().lifecycle.appState).toBe("background");

    store.dispatch(appForegrounded({ at: 1234 }));
    expect(store.getState().lifecycle.appState).toBe("active");
    expect(store.getState().lifecycle.lastForegroundAt).toBe(1234);

    store.dispatch(setOnline(false));
    expect(store.getState().lifecycle.isOnline).toBe(false);
  });
});
