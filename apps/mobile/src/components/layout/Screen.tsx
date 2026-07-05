import { useContext, type ReactNode } from "react";
import { Platform, ScrollView, View, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { HeaderHeightContext } from "@react-navigation/elements";

import { cn } from "@/lib/cn";

// Layout under glass chrome (W1 §3): iOS headers are transparent blur and the
// tab bar is absolute, so content must inset itself. This is the one place
// that knows how. Contexts (not hooks) so screens outside a tab/header scope
// resolve to 0 instead of throwing.

export interface ScreenInsets {
  /** Manual top padding — 0 on iOS scroll surfaces (UIKit adjusts). */
  top: number;
  /** Bottom padding clearing the absolute tab bar (0 when none). */
  bottom: number;
  /** Height of the (translucent) header above this screen. */
  headerHeight: number;
  /** Full tab bar height incl. safe area (0 outside the tab navigator). */
  tabBarHeight: number;
}

/** Inset math for custom containers (FlatList screens use this directly). */
export function useScreenInsets(options: { scroll?: boolean } = {}): ScreenInsets {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const safe = useSafeAreaInsets();

  if (Platform.OS === "ios") {
    // Scroll views get contentInsetAdjustmentBehavior="automatic": UIKit
    // covers the header + bottom safe area; we only add the tab bar's
    // above-safe-area portion. Non-scroll layouts pad everything manually.
    const tabBarPad = Math.max(0, tabBarHeight - (tabBarHeight > 0 ? safe.bottom : 0));
    return options.scroll
      ? { top: 0, bottom: tabBarPad, headerHeight, tabBarHeight }
      : {
          top: headerHeight > 0 ? headerHeight : safe.top,
          bottom: tabBarHeight > 0 ? tabBarHeight : safe.bottom,
          headerHeight,
          tabBarHeight,
        };
  }

  // Android: headers are opaque (no top inset needed under a header); the
  // absolute tab bar still needs clearing.
  return {
    top: headerHeight > 0 ? 0 : safe.top,
    bottom: tabBarHeight > 0 ? tabBarHeight : 0,
    headerHeight,
    tabBarHeight,
  };
}

export interface ScreenProps extends ScrollViewProps {
  /** Scrollable content (ScrollView) vs a fixed flex layout (View). */
  scroll?: boolean;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

export function Screen({
  scroll = false,
  className,
  contentClassName,
  children,
  contentContainerStyle,
  ...rest
}: ScreenProps) {
  const insets = useScreenInsets({ scroll });

  if (!scroll) {
    return (
      <View
        className={cn("flex-1 bg-background", className, contentClassName)}
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      className={cn("flex-1 bg-background", className)}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName={contentClassName}
      contentContainerStyle={[
        { paddingTop: insets.top, paddingBottom: insets.bottom + 16 },
        contentContainerStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      {...rest}
    >
      {children}
    </ScrollView>
  );
}
