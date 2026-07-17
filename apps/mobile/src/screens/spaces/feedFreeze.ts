// Freeze-while-reading for the live notes feed. While the user is scrolled
// into the feed (or dragging), the rendered rows hold a snapshot of event
// OBJECTS — not ids, so FEED_CAP eviction in the slice can't delete entities
// out from under mid-read rows. Live events keep flowing into the slice
// unchanged; the feed shows a "new notes" pill instead of yanking the
// viewport. Snapshot is captured once per freeze and never grows.

import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

/** Scroll offset past which the rendered rows freeze. */
export const FREEZE_OFFSET_PX = 24;

/** Scroll offset past which the back-to-top affordance appears (~one screen). */
export const BACK_TO_TOP_OFFSET_PX = 480;

/** Live events not in the frozen snapshot and not muted — the pill count. */
export function countFreshEvents(
  live: NostrEvent[],
  frozenIds: Set<string>,
  muted: Record<string, true>,
): number {
  let count = 0;
  for (const event of live) {
    if (!frozenIds.has(event.id) && !muted[event.pubkey]) count++;
  }
  return count;
}

type ScrollHandler = (e: NativeSyntheticEvent<NativeScrollEvent>) => void;

export interface FeedFreeze {
  /** Snapshot rendered while frozen; null = render live. */
  frozen: NostrEvent[] | null;
  /** True once scrolled past BACK_TO_TOP_OFFSET_PX — shows the affordance. */
  scrolledDeep: boolean;
  unfreeze(): void;
  /** Freeze now if the viewport is scrolled into the feed — the blur hook.
   *  Pushing a thread/profile over the feed must pin the rows so back-nav
   *  lands exactly where reading stopped; dropping the snapshot on blur
   *  swapped in the live array (with everything that arrived meanwhile)
   *  and shifted the restored scroll position. No-op at the top. */
  freezeIfScrolled(): void;
  /** Spread onto the FlatList (with scrollEventThrottle={16}). */
  handlers: {
    onScroll: ScrollHandler;
    onScrollBeginDrag: ScrollHandler;
    onScrollEndDrag: ScrollHandler;
    onMomentumScrollEnd: ScrollHandler;
  };
}

export function useFeedFreeze(live: NostrEvent[]): FeedFreeze {
  const [frozen, setFrozen] = useState<NostrEvent[] | null>(null);
  const [scrolledDeep, setScrolledDeep] = useState(false);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const lastOffsetY = useRef(0);

  // Capture-once: the snapshot never changes while frozen.
  const freeze = useCallback(() => {
    setFrozen((prev) => prev ?? liveRef.current);
  }, []);
  const unfreeze = useCallback(() => setFrozen(null), []);
  const freezeIfScrolled = useCallback(() => {
    if (lastOffsetY.current > FREEZE_OFFSET_PX) freeze();
  }, [freeze]);

  const handlers = useRef<FeedFreeze["handlers"]>({
    onScroll: (e) => {
      const y = e.nativeEvent.contentOffset.y;
      lastOffsetY.current = y;
      if (y > FREEZE_OFFSET_PX) freeze();
      setScrolledDeep(y > BACK_TO_TOP_OFFSET_PX);
    },
    // A finger resting in the feed must not have rows swap beneath it.
    // Pull-to-refresh drags produce y <= 0, so they never freeze.
    onScrollBeginDrag: (e) => {
      lastOffsetY.current = e.nativeEvent.contentOffset.y;
      if (e.nativeEvent.contentOffset.y > 0) freeze();
    },
    onScrollEndDrag: (e) => {
      lastOffsetY.current = e.nativeEvent.contentOffset.y;
      if (e.nativeEvent.contentOffset.y <= FREEZE_OFFSET_PX) unfreeze();
    },
    onMomentumScrollEnd: (e) => {
      lastOffsetY.current = e.nativeEvent.contentOffset.y;
      if (e.nativeEvent.contentOffset.y <= FREEZE_OFFSET_PX) unfreeze();
    },
  }).current;

  return { frozen, scrolledDeep, unfreeze, freezeIfScrolled, handlers };
}
