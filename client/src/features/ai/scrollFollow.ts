/**
 * Pure decision logic for "stick to bottom unless the user scrolls away" — kept
 * separate from the DOM so it's testable (jsdom has no layout). The component
 * feeds in raw scroll metrics; these decide whether to keep following the bottom.
 */
export const BOTTOM_PX = 64;

export interface ScrollMetrics {
  top: number;
  lastTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Within BOTTOM_PX of the bottom counts as "at the bottom". */
export function isAtBottom(m: ScrollMetrics, bottomPx = BOTTOM_PX): boolean {
  return m.scrollHeight - m.top - m.clientHeight < bottomPx;
}

/**
 * Next follow state from a USER scroll event (programmatic scrolls are filtered
 * out by the caller). A real upward move releases the follow; reaching the
 * bottom re-attaches it; scrolling down but not yet at the bottom is unchanged.
 */
export function nextStick(prev: boolean, m: ScrollMetrics, bottomPx = BOTTOM_PX): boolean {
  if (m.top < m.lastTop - 2) return false; // user pulled up → stop following
  if (isAtBottom(m, bottomPx)) return true; // returned to bottom → follow again
  return prev;
}
