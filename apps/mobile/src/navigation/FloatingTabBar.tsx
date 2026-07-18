// ─── Floating pill tab bar ───────────────────────────────────────────
// Custom tabBar: a detached, fully-rounded glass pill with a sliding
// primary-filled circle behind the active icon (the inversion IS the signal
// — no labels, no tint change). Icons render primaryForeground on the circle,
// muted otherwise, so every preset reads correctly from the same tokens.
//
// Load-bearing: React Navigation does NOT measure custom tab bars — it seeds
// BottomTabBarHeightContext with a stock-bar estimate. We report our real
// height (pill + float gap + safe area) through
// BottomTabBarHeightCallbackContext so useScreenInsets (components/layout/
// Screen.tsx) clears the pill app-wide.
//
// The sliding circle is a bare Animated.View with plain styles only — an
// element takes className OR an animated style, never both (lib/animated.ts).

import { useContext, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { AnimatedPlainView } from "@/lib/animated";
import {
  BottomTabBarHeightCallbackContext,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { CommonActions } from "@react-navigation/native";
import { BlurView } from "expo-blur";

import { MiniPlayer } from "@/components/music/MiniPlayer";
import { GLASS_BLUR_INTENSITY } from "@/theme/constants";
import { withAlpha } from "@/theme/engine";
import { SPRING } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";

const FLOAT_GAP = 14;
const H_MARGIN = 18;
const PILL_HEIGHT = 56;
const CIRCLE_SIZE = 34;
const ICON_SIZE = 22;

/** Glass material for the pill — chrome-only rule (screenOptions.ts): iOS
 *  gets system blur under a theme wash; Android a solid translucent fill. */
function GlassTabBackground() {
  const { config, extras, isDark } = useTheme();
  if (Platform.OS !== "ios") {
    return <View style={[StyleSheet.absoluteFill, { backgroundColor: extras.glassBg }]} />;
  }
  return (
    <BlurView
      intensity={GLASS_BLUR_INTENSITY * 3}
      tint={isDark ? "dark" : "light"}
      style={StyleSheet.absoluteFill}
    >
      {/* Theme wash over the system blur so the bar carries the preset hue. */}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: withAlpha(config.colors.background, 0.55) },
        ]}
      />
    </BlurView>
  );
}

export function FloatingTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { tokens } = useTheme();
  const onHeightChange = useContext(BottomTabBarHeightCallbackContext);
  const [rowWidth, setRowWidth] = useState(0);
  const slot = rowWidth > 0 ? rowWidth / state.routes.length : 0;

  const circleX = useSharedValue(0);
  const hasPositioned = useRef(false);
  useEffect(() => {
    if (slot <= 0) return;
    const target = slot * state.index + (slot - CIRCLE_SIZE) / 2;
    if (!hasPositioned.current) {
      // First real layout: place the circle, don't slide in from x=0.
      hasPositioned.current = true;
      circleX.value = target;
      return;
    }
    circleX.value = withSpring(target, SPRING.snappy);
  }, [circleX, slot, state.index]);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: circleX.value }],
  }));

  return (
    <View
      testID="floating-tab-bar"
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom + FLOAT_GAP,
        paddingHorizontal: H_MARGIN,
      }}
      onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.height)}
    >
      {/* Docked mini-player above the pill — its height folds into this
          container's onLayout report, so useScreenInsets clears both. Renders
          null when nothing is playing. navigate bubbles to the root NowPlaying
          modal (same path MusicHome uses). */}
      <MiniPlayer onOpen={() => navigation.navigate("NowPlaying")} />
      <View
        style={{
          height: PILL_HEIGHT,
          borderRadius: PILL_HEIGHT / 2,
          overflow: "hidden",
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tokens.borderLight,
        }}
      >
        <GlassTabBackground />
        <View
          style={{ flex: 1, flexDirection: "row" }}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {slot > 0 ? (
            // Animated style ⇒ AnimatedPlainView, no className (lib/animated.ts).
            <AnimatedPlainView
              style={[
                {
                  position: "absolute",
                  top: (PILL_HEIGHT - CIRCLE_SIZE) / 2,
                  left: 0,
                  width: CIRCLE_SIZE,
                  height: CIRCLE_SIZE,
                  borderRadius: CIRCLE_SIZE / 2,
                  backgroundColor: tokens.primary,
                },
                circleStyle,
              ]}
            />
          ) : null}
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const focused = state.index === index;
            const color = focused ? tokens.primaryForeground : tokens.muted;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.dispatch({
                  ...CommonActions.navigate(route),
                  target: state.key,
                });
              }
            };

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={
                  options.tabBarAccessibilityLabel ?? options.title ?? route.name
                }
                style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
                onPress={onPress}
                onLongPress={() =>
                  navigation.emit({ type: "tabLongPress", target: route.key })
                }
              >
                {options.tabBarIcon?.({ focused, color, size: ICON_SIZE }) ?? null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
