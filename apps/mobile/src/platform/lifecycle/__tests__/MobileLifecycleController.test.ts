import { AppState, type AppStateStatus } from "react-native";

import { MobileLifecycleController, type LifecycleEvents } from "../MobileLifecycleController";

// Capture the NetInfo listener so tests can push connectivity transitions.
// (jest.mock factories may only reference `mock*`-prefixed outer variables.)
type MockNetInfoState = { isConnected: boolean | null; isInternetReachable?: boolean | null };
let mockNetInfoListener: ((state: MockNetInfoState) => void) | undefined;
const mockNetInfoUnsubscribe = jest.fn();
const mockNetInfoFetch = jest.fn<Promise<MockNetInfoState>, []>();

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (cb: (state: MockNetInfoState) => void) => {
      mockNetInfoListener = cb;
      return mockNetInfoUnsubscribe;
    },
    fetch: () => mockNetInfoFetch(),
  },
}));

/** Let pending NetInfo.fetch() promises resolve under fake timers. */
const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve());

describe("MobileLifecycleController", () => {
  let appStateListener: ((status: AppStateStatus) => void) | undefined;
  const appStateRemove = jest.fn();
  let events: jest.Mocked<LifecycleEvents>;
  let controller: MobileLifecycleController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoListener = undefined;
    appStateListener = undefined;
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });

    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      appStateListener = handler as (status: AppStateStatus) => void;
      return { remove: appStateRemove } as ReturnType<typeof AppState.addEventListener>;
    });

    events = {
      onForeground: jest.fn(),
      onBackground: jest.fn(),
      onOnline: jest.fn(),
      onOffline: jest.fn(),
    };
    controller = new MobileLifecycleController(events);
  });

  afterEach(() => {
    controller.stop();
    jest.useRealTimers();
  });

  it("subscribes on start and unsubscribes on stop", () => {
    controller.start();
    expect(appStateListener).toBeDefined();
    expect(mockNetInfoListener).toBeDefined();

    controller.stop();
    expect(appStateRemove).toHaveBeenCalled();
    expect(mockNetInfoUnsubscribe).toHaveBeenCalled();
  });

  it("start is idempotent", () => {
    controller.start();
    controller.start();
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("reports background → foreground with the backgrounded duration", () => {
    const now = jest.spyOn(Date, "now");
    controller.start();

    now.mockReturnValue(1_000);
    appStateListener!("background");
    expect(events.onBackground).toHaveBeenCalledTimes(1);

    now.mockReturnValue(6_000);
    appStateListener!("active");
    expect(events.onForeground).toHaveBeenCalledWith(5_000);
  });

  it("ignores inactive→background flapping while already backgrounded", () => {
    controller.start();
    appStateListener!("inactive"); // iOS passes through inactive first
    appStateListener!("background");
    expect(events.onBackground).toHaveBeenCalledTimes(1);
  });

  it("emits connectivity edges only on change", () => {
    controller.start();

    mockNetInfoListener!({ isConnected: true }); // already online — no edge
    expect(events.onOnline).not.toHaveBeenCalled();

    mockNetInfoListener!({ isConnected: false });
    expect(events.onOffline).toHaveBeenCalledTimes(1);

    mockNetInfoListener!({ isConnected: false }); // no repeat
    expect(events.onOffline).toHaveBeenCalledTimes(1);

    mockNetInfoListener!({ isConnected: true });
    expect(events.onOnline).toHaveBeenCalledTimes(1);
  });

  it("re-probes while offline and recovers when the event stream drops the edge", async () => {
    // The iOS failure mode: NetInfo never emits the recovery event.
    jest.useFakeTimers();
    controller.start();

    mockNetInfoFetch.mockResolvedValue({ isConnected: false });
    mockNetInfoListener!({ isConnected: false });
    expect(events.onOffline).toHaveBeenCalledTimes(1);

    // Still down on the first probe.
    jest.advanceTimersByTime(4_000);
    await flushMicrotasks();
    expect(events.onOnline).not.toHaveBeenCalled();

    // Network returns — but only fetch() sees it.
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });
    jest.advanceTimersByTime(4_000);
    await flushMicrotasks();
    expect(events.onOnline).toHaveBeenCalledTimes(1);

    // Probe loop stops once online.
    const probeCalls = mockNetInfoFetch.mock.calls.length;
    jest.advanceTimersByTime(20_000);
    await flushMicrotasks();
    expect(mockNetInfoFetch.mock.calls.length).toBe(probeCalls);
  });

  it("re-checks connectivity on every foreground", async () => {
    controller.start();

    mockNetInfoListener!({ isConnected: false });
    expect(events.onOffline).toHaveBeenCalledTimes(1);

    appStateListener!("background");
    // Connectivity recovered while suspended; the event stream missed it.
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });
    appStateListener!("active");
    await flushMicrotasks();

    expect(events.onOnline).toHaveBeenCalledTimes(1);
    expect(events.onForeground).toHaveBeenCalledTimes(1);
  });

  it("a stale probe result cannot resurrect a stopped controller", async () => {
    jest.useFakeTimers();
    controller.start();
    mockNetInfoFetch.mockResolvedValue({ isConnected: false });
    mockNetInfoListener!({ isConnected: false });

    // Probe in flight when the controller stops.
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });
    jest.advanceTimersByTime(4_000);
    controller.stop();
    await flushMicrotasks();

    expect(events.onOnline).not.toHaveBeenCalled();
  });

  it("treats isInternetReachable as a positive signal when isConnected lies", () => {
    controller.start();

    mockNetInfoListener!({ isConnected: false, isInternetReachable: false });
    expect(events.onOffline).toHaveBeenCalledTimes(1);

    // The iOS-sim shape: isConnected sticks false but reachability recovers.
    mockNetInfoListener!({ isConnected: false, isInternetReachable: true });
    expect(events.onOnline).toHaveBeenCalledTimes(1);
  });

  it("socket evidence clears offline when NetInfo never recovers (regression)", async () => {
    // The stuck-banner bug: recovery event dropped AND the probe keeps
    // reporting offline — but a relay socket connects.
    jest.useFakeTimers();
    let evidence = false;
    controller = new MobileLifecycleController(events, {
      hasConnectivityEvidence: () => evidence,
    });
    controller.start();

    mockNetInfoFetch.mockResolvedValue({ isConnected: false });
    mockNetInfoListener!({ isConnected: false });
    expect(events.onOffline).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(4_000);
    await flushMicrotasks();
    expect(events.onOnline).not.toHaveBeenCalled();

    // A relay reaches "connected" — App.tsx pushes the evidence.
    evidence = true;
    controller.reportOnlineEvidence();
    expect(events.onOnline).toHaveBeenCalledTimes(1);

    // NetInfo still claims offline, so the probe loop keeps running — but
    // live-socket evidence holds the verdict online (no flapping).
    jest.advanceTimersByTime(8_000);
    await flushMicrotasks();
    expect(events.onOnline).toHaveBeenCalledTimes(1);
    expect(events.onOffline).toHaveBeenCalledTimes(1);

    // NetInfo finally recovers → the loop stops.
    mockNetInfoFetch.mockResolvedValue({ isConnected: true });
    jest.advanceTimersByTime(4_000);
    await flushMicrotasks();
    const probeCalls = mockNetInfoFetch.mock.calls.length;
    jest.advanceTimersByTime(20_000);
    await flushMicrotasks();
    expect(mockNetInfoFetch.mock.calls.length).toBe(probeCalls);
  });

  it("a NetInfo offline claim is suppressed while sockets are live, then honored when they die", async () => {
    jest.useFakeTimers();
    let evidence = true;
    controller = new MobileLifecycleController(events, {
      hasConnectivityEvidence: () => evidence,
    });
    controller.start();

    // One failed probe/event must not re-flag offline over live sockets.
    mockNetInfoFetch.mockResolvedValue({ isConnected: false });
    mockNetInfoListener!({ isConnected: false });
    expect(events.onOffline).not.toHaveBeenCalled();

    // Sockets die while NetInfo stays silent — the claim-keyed probe loop
    // re-evaluates and flips offline (no deadlock).
    evidence = false;
    jest.advanceTimersByTime(4_000);
    await flushMicrotasks();
    expect(events.onOffline).toHaveBeenCalledTimes(1);
  });
});
