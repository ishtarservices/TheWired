// Reanimated View registered with NativeWind exactly once — plus the
// unregistered escape hatch for useAnimatedStyle elements.
//
// LOAD-BEARING CONSTRAINTS (verified in-sim, css-interop 0.2.6 × reanimated
// 4.5):
//   • An element may have className OR a Reanimated animated style — never
//     both, or it renders with NO styles at all.
//   • The css-interop-REGISTERED Animated.View drops a useAnimatedStyle even
//     WITHOUT a className (verified in-sim: the FloatingTabBar circle
//     rendered with no styles at all). Registration is by component
//     reference, so animated-style elements must use a component that was
//     never registered: AnimatedPlainView below.
// Safe combinations:
//   • AnimatedView + className + entering= (layout animations)          ✓
//   • AnimatedPlainView + plain style only + useAnimatedStyle           ✓
//   • core component + className + plain style object                  ✓
// For press feedback on styled components, use Pressable pressed-state
// styles (see Button/Card), not an animated transform.

import { View } from "react-native";
import Animated from "react-native-reanimated";
import { cssInterop } from "nativewind";

export const AnimatedView = Animated.View;
cssInterop(AnimatedView, { className: "style" });

/** Unregistered animated view — the only element type that reliably carries
 *  a useAnimatedStyle. No className support (by design). */
export const AnimatedPlainView = Animated.createAnimatedComponent(View);
