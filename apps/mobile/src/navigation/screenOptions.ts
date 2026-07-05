import { Platform } from "react-native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

import { useTheme } from "@/theme/ThemeContext";

// Glass chrome (W1 §3): on iOS every stack header is translucent — content
// scrolls under it (screens opt in via contentInsetAdjustmentBehavior=
// "automatic", see components/layout/Screen). On iOS 26+ the system's own
// Liquid Glass scroll-edge effect provides the material (adding our own
// blurEffect double-layers it — RNScreens warns); older iOS gets an explicit
// chrome-material blur. Android keeps opaque panel headers (blur there is
// expensive and Expo Go's implementation is experimental). Glass lives ONLY
// on chrome — content cards and forms stay opaque for contrast.

const IOS_MAJOR = Platform.OS === "ios" ? parseInt(String(Platform.Version), 10) : 0;
const HAS_LIQUID_GLASS = IOS_MAJOR >= 26;

/** Shared themed options for every native stack. */
export function useStackScreenOptions(): NativeStackNavigationOptions {
  const { tokens, isDark, type } = useTheme();

  const shared: NativeStackNavigationOptions = {
    headerTintColor: tokens.primary,
    headerTitleStyle: {
      color: tokens.heading,
      fontFamily: type("headline").fontFamily,
      fontSize: 17,
    },
    headerBackButtonDisplayMode: "minimal",
    headerShadowVisible: false,
    contentStyle: { backgroundColor: tokens.background },
  };

  if (Platform.OS === "ios") {
    return {
      ...shared,
      headerTransparent: true,
      ...(HAS_LIQUID_GLASS
        ? null
        : { headerBlurEffect: isDark ? "systemChromeMaterialDark" : "systemChromeMaterial" }),
      headerStyle: { backgroundColor: "transparent" },
    };
  }

  return {
    ...shared,
    headerStyle: { backgroundColor: tokens.panel },
  };
}

/** Tab-root screens: iOS large-title pattern — a big confident title that
 *  collapses into the glass bar on scroll (needs a ScrollView/FlatList with
 *  contentInsetAdjustmentBehavior="automatic" as the screen's main child). */
export function useLargeTitleScreenOptions(): NativeStackNavigationOptions {
  const base = useStackScreenOptions();
  const { tokens, type } = useTheme();

  if (Platform.OS !== "ios") return base;

  return {
    ...base,
    headerLargeTitle: true,
    headerLargeTitleShadowVisible: false,
    headerLargeStyle: { backgroundColor: "transparent" },
    headerLargeTitleStyle: {
      color: tokens.heading,
      fontFamily: type("display").fontFamily,
    },
  };
}
