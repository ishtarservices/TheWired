// ─── Mobile lifecycle controller ─────────────────────────────────────
// The #1 mobile risk (guide 00): iOS suspends the app and kills its sockets
// seconds after backgrounding; the desktop core has zero AppState/NetInfo
// handling. This controller owns those transitions and stays transport-
// agnostic — App.tsx routes the events into both Redux (lifecycleSlice) and
// the Nostr engine (suspend / resume-with-fresh-since / reconnect-now).

import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import NetInfo, { type NetInfoSubscription } from "@react-native-community/netinfo";

export interface LifecycleEvents {
  /** App came to the foreground. `backgroundedForMs` is null on first launch. */
  onForeground(backgroundedForMs: number | null): void;
  onBackground(): void;
  onOnline(): void;
  onOffline(): void;
}

export class MobileLifecycleController {
  private appStateSub: NativeEventSubscription | null = null;
  private netInfoSub: NetInfoSubscription | null = null;
  // iOS can report "unknown"/"inactive" at launch — treat anything that isn't
  // an established background as active so the first real background emits.
  private lastAppState: AppStateStatus =
    AppState.currentState === "background" ? "background" : "active";
  private backgroundedAt: number | null = null;
  private isOnline = true;

  constructor(private readonly events: LifecycleEvents) {}

  start(): void {
    if (this.appStateSub) return;

    this.appStateSub = AppState.addEventListener("change", this.handleAppState);
    this.netInfoSub = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true;
      if (online === this.isOnline) return;
      this.isOnline = online;
      if (online) {
        // App routes this to engine.handleOnline() — immediate reconnect
        // instead of waiting out the backoff timers.
        this.events.onOnline();
      } else {
        this.events.onOffline();
      }
    });
  }

  stop(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.netInfoSub?.();
    this.netInfoSub = null;
  }

  private handleAppState = (next: AppStateStatus) => {
    const prev = this.lastAppState;
    this.lastAppState = next;

    if (next === "active" && prev !== "active") {
      const backgroundedForMs =
        this.backgroundedAt !== null ? Date.now() - this.backgroundedAt : null;
      this.backgroundedAt = null;
      // App routes this to engine.handleForeground(): reopen the pool and
      // resubscribe with fresh `since`, because iOS killed the sockets while
      // suspended — reconnection alone would silently miss events.
      this.events.onForeground(backgroundedForMs);
    } else if (next !== "active" && prev === "active") {
      this.backgroundedAt = Date.now();
      // App routes this to engine.handleBackground(): flush persistence and
      // close sockets proactively rather than letting iOS kill them mid-write.
      this.events.onBackground();
    }
  };
}
