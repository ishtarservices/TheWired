import { AppState, type AppStateStatus } from "react-native";

import { MobileLifecycleController, type LifecycleEvents } from "../MobileLifecycleController";

// Capture the NetInfo listener so tests can push connectivity transitions.
// (jest.mock factories may only reference `mock*`-prefixed outer variables.)
let mockNetInfoListener: ((state: { isConnected: boolean | null }) => void) | undefined;
const mockNetInfoUnsubscribe = jest.fn();

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (cb: (state: { isConnected: boolean | null }) => void) => {
      mockNetInfoListener = cb;
      return mockNetInfoUnsubscribe;
    },
  },
}));

describe("MobileLifecycleController", () => {
  let appStateListener: ((status: AppStateStatus) => void) | undefined;
  const appStateRemove = jest.fn();
  let events: jest.Mocked<LifecycleEvents>;
  let controller: MobileLifecycleController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockNetInfoListener = undefined;
    appStateListener = undefined;

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
});
