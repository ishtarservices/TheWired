// ─── Mobile lifecycle controller ─────────────────────────────────────
// The #1 mobile risk (guide 00): iOS suspends the app and kills its sockets
// seconds after backgrounding; the desktop core has zero AppState/NetInfo
// handling. This controller owns those transitions and stays transport-
// agnostic — App.tsx routes the events into both Redux (lifecycleSlice) and
// the Nostr engine (suspend / resume-with-fresh-since / reconnect-now).
//
// NetInfo is unreliable on iOS (especially the simulator): recovery EVENTS
// frequently never fire, and even NetInfo.fetch() can keep reporting
// isConnected/isInternetReachable false after the network returns. So
// NetInfo is only a claim, not the verdict:
//   • the published verdict is `netinfoOnline || hasConnectivityEvidence()`
//     — app-level proof (a relay socket currently "connected") beats probes;
//   • reportOnlineEvidence() lets App.tsx push that proof the moment a
//     socket connects while we believe we're offline;
//   • while NetInfo claims offline we re-probe every few seconds — keyed to
//     the CLAIM, not the verdict, so if evidence is holding us online and
//     the sockets later die, the next probe re-evaluates and flips offline
//     instead of deadlocking. The interval never exists while NetInfo is
//     positive (zero cost online); every foreground re-checks too.

import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import NetInfo, { type NetInfoSubscription } from "@react-native-community/netinfo";

const OFFLINE_REPROBE_MS = 4_000;

export interface LifecycleEvents {
  /** App came to the foreground. `backgroundedForMs` is null on first launch. */
  onForeground(backgroundedForMs: number | null): void;
  onBackground(): void;
  onOnline(): void;
  onOffline(): void;
}

export interface ConnectivityDeps {
  /** App-level proof of connectivity — e.g. any engine relay socket with a
   *  live "connected" status. Consulted whenever NetInfo claims offline. */
  hasConnectivityEvidence?: () => boolean;
}

/** Structural subset of NetInfoState the controller reads. */
interface NetInfoSnapshot {
  isConnected: boolean | null;
  isInternetReachable?: boolean | null;
}

export class MobileLifecycleController {
  private appStateSub: NativeEventSubscription | null = null;
  private netInfoSub: NetInfoSubscription | null = null;
  private reprobeTimer: ReturnType<typeof setInterval> | null = null;
  // iOS can report "unknown"/"inactive" at launch — treat anything that isn't
  // an established background as active so the first real background emits.
  private lastAppState: AppStateStatus =
    AppState.currentState === "background" ? "background" : "active";
  private backgroundedAt: number | null = null;
  /** NetInfo's latest claim. */
  private netinfoOnline = true;
  /** The published verdict (what lifecycleSlice.isOnline mirrors). */
  private isOnline = true;
  private stopped = true;

  constructor(
    private readonly events: LifecycleEvents,
    private readonly deps: ConnectivityDeps = {},
  ) {}

  start(): void {
    if (this.appStateSub) return;
    this.stopped = false;

    this.appStateSub = AppState.addEventListener("change", this.handleAppState);
    this.netInfoSub = NetInfo.addEventListener((state) => {
      this.handleNetInfo(state);
    });
  }

  stop(): void {
    this.stopped = true;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.netInfoSub?.();
    this.netInfoSub = null;
    this.stopReprobe();
  }

  /** App-level proof of being online (a relay socket reached "connected")
   *  — clears "offline" even when NetInfo never reports the recovery. */
  reportOnlineEvidence(): void {
    this.publish(true);
  }

  /** Single NetInfo truth path — events and probes both land here. Either
   *  positive field counts: on iOS one of the two routinely sticks
   *  false/null after recovery while the other tells the truth. */
  private handleNetInfo(state: NetInfoSnapshot): void {
    if (this.stopped) return;
    this.netinfoOnline =
      state.isConnected === true || state.isInternetReachable === true;
    if (this.netinfoOnline) this.stopReprobe();
    else this.startReprobe();
    this.publish(this.netinfoOnline || this.hasEvidence());
  }

  private hasEvidence(): boolean {
    try {
      return this.deps.hasConnectivityEvidence?.() === true;
    } catch {
      return false;
    }
  }

  /** Single verdict path — NetInfo evaluations and pushed evidence. */
  private publish(online: boolean): void {
    if (this.stopped || online === this.isOnline) return;
    this.isOnline = online;
    if (online) {
      // App routes this to engine.handleOnline() — immediate reconnect
      // instead of waiting out the backoff timers.
      this.events.onOnline();
    } else {
      this.events.onOffline();
    }
  }

  /** Ask NetInfo directly — covers the missed-recovery-event case. */
  private probe(): void {
    NetInfo.fetch()
      .then((state) => this.handleNetInfo(state))
      .catch(() => {});
  }

  private startReprobe(): void {
    if (this.reprobeTimer) return;
    this.reprobeTimer = setInterval(() => this.probe(), OFFLINE_REPROBE_MS);
  }

  private stopReprobe(): void {
    if (this.reprobeTimer) {
      clearInterval(this.reprobeTimer);
      this.reprobeTimer = null;
    }
  }

  private handleAppState = (next: AppStateStatus) => {
    const prev = this.lastAppState;
    this.lastAppState = next;

    if (next === "active" && prev !== "active") {
      const backgroundedForMs =
        this.backgroundedAt !== null ? Date.now() - this.backgroundedAt : null;
      this.backgroundedAt = null;
      // Connectivity may have changed while suspended and the event stream
      // dropped it — re-check directly on every wake.
      this.probe();
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
