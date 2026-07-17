// Chat auto-scroll predicate. The channel list is ascending (never inverted
// — persistently blurry under RN 0.86's new architecture), so "pinned to the
// latest message" means scrolled near the CONTENT END. Pure so the geometry
// math is testable; ChannelScreen tracks the result in a ref via onScroll
// and only auto-scrolls on content growth while it holds (B2 — no more
// yanking the reader to the bottom mid-history).

import type { NativeScrollEvent } from "react-native";

/** Distance from the bottom (pt) within which auto-scroll stays engaged. */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

type ScrollGeometry = Pick<
  NativeScrollEvent,
  "layoutMeasurement" | "contentOffset" | "contentSize"
>;

/** Is the viewport within `threshold` of the content end? Content shorter
 *  than the viewport is always "near bottom" (nothing to scroll). */
export function isNearBottom(
  e: ScrollGeometry,
  threshold: number = NEAR_BOTTOM_THRESHOLD_PX,
): boolean {
  return (
    e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - threshold
  );
}
