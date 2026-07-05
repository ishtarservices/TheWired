// ─── Mobile lifecycle controller (skeleton) ──────────────────────────
// The #1 mobile risk (guide 00): iOS suspends the app and kills its sockets
// seconds after backgrounding; the desktop core has zero AppState/NetInfo
// handling. This controller owns those transitions. Until the relay pool
// exists (Phase 0/1 wiring), the hooks only report state — the TODOs mark
// where teardown/rebuild lands.

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
        // TODO(Phase 1): reconnect the relay pool immediately instead of
        // waiting out the backoff timers.
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
      // TODO(Phase 1): rebuild the relay pool + resubscribe with fresh `since`
      // (= last-seen timestamps), because iOS killed the sockets while
      // suspended — reconnection alone would silently miss events.
      this.events.onForeground(backgroundedForMs);
    } else if (next !== "active" && prev === "active") {
      this.backgroundedAt = Date.now();
      // TODO(Phase 1): graceful teardown — flush the publish outbox, CLOSE
      // subscriptions, let push carry delivery while backgrounded.
      this.events.onBackground();
    }
  };
}
