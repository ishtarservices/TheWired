// Reanimated View registered with NativeWind exactly once.
//
// LOAD-BEARING CONSTRAINT (verified in-sim, css-interop 0.2.6 × reanimated
// 4.5): an element may have className OR a Reanimated animated style — never
// both, or it renders with NO styles at all. Safe combinations:
//   • AnimatedView + className + entering= (layout animations)  ✓
//   • AnimatedView + plain style only (no className) + useAnimatedStyle ✓
//   • core component + className + plain style object            ✓
// For press feedback on styled components, use Pressable pressed-state
// styles (see Button/Card), not an animated transform.

import Animated from "react-native-reanimated";
import { cssInterop } from "nativewind";

export const AnimatedView = Animated.View;
cssInterop(AnimatedView, { className: "style" });
