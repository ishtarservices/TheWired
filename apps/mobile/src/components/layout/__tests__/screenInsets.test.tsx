import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react-native";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useScreenInsets } from "../Screen";

// jest-expo runs as iOS — these cases exercise the iOS branches (the Android
// branch shares the tabBarHeight passthrough asserted here).

const SAFE = { top: 59, bottom: 34, left: 0, right: 0 };
const FRAME = { x: 0, y: 0, width: 390, height: 844 };

// The floating pill reports pill + float gap + safe bottom = 56 + 14 + 34.
const TAB_BAR_HEIGHT = 104;

function withProviders(tabBarHeight?: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const inner =
      tabBarHeight === undefined ? (
        children
      ) : (
        <BottomTabBarHeightContext.Provider value={tabBarHeight}>
          {children}
        </BottomTabBarHeightContext.Provider>
      );
    return (
      <SafeAreaProvider initialMetrics={{ insets: SAFE, frame: FRAME }}>
        {inner}
      </SafeAreaProvider>
    );
  };
}

describe("useScreenInsets", () => {
  it("scroll surfaces clear the pill minus the UIKit-covered safe area", async () => {
    const { result } = await renderHook(() => useScreenInsets({ scroll: true }), {
      wrapper: withProviders(TAB_BAR_HEIGHT),
    });
    expect(result.current.bottom).toBe(TAB_BAR_HEIGHT - SAFE.bottom); // 70
    expect(result.current.top).toBe(0); // contentInsetAdjustmentBehavior covers it
    expect(result.current.tabBarHeight).toBe(TAB_BAR_HEIGHT);
  });

  it("non-scroll surfaces pad the full reported bar height", async () => {
    const { result } = await renderHook(() => useScreenInsets(), {
      wrapper: withProviders(TAB_BAR_HEIGHT),
    });
    expect(result.current.bottom).toBe(TAB_BAR_HEIGHT);
    expect(result.current.top).toBe(SAFE.top); // no header in scope
  });

  it("falls back to safe-area padding outside a tab navigator", async () => {
    const { result } = await renderHook(() => useScreenInsets(), {
      wrapper: withProviders(undefined),
    });
    expect(result.current.tabBarHeight).toBe(0);
    expect(result.current.bottom).toBe(SAFE.bottom);
  });

  it("scroll surfaces outside a tab navigator add no bottom padding", async () => {
    const { result } = await renderHook(() => useScreenInsets({ scroll: true }), {
      wrapper: withProviders(undefined),
    });
    expect(result.current.bottom).toBe(0);
  });
});
