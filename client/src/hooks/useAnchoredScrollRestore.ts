import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Anchor-aware scroll restoration for feeds whose height grows *after* paint
 * (note media that doesn't reserve a box until it loads).
 *
 * A raw pixel offset is fragile here: on remount the cards render immediately
 * from Redux, but their images are 0px tall until they load, so `scrollHeight`
 * is a fraction of what it was when the offset was saved. Setting the saved
 * pixel offset clamps to the (short) max scroll → the feed "snaps to the top",
 * and late image loads above the fold shift everything underneath even after a
 * lucky restore.
 *
 * Instead we remember the *card* the viewport was sitting on (its id + the px
 * scrolled past its top) and, on restore, scroll so that same card lands in the
 * same place. Because we re-resolve the card's live position, growth elsewhere
 * can't drift it. We keep re-pinning for a short window as media loads, and bow
 * out the instant the user scrolls.
 *
 * Pixel offset is still stored and used as a fallback (anchor missing, or the
 * viewport was above the first card — e.g. in a profile header).
 */
/** Stop re-pinning once the anchor target holds steady for this many frames. */
const REPIN_STABLE_FRAMES = 8;

export interface SavedScrollPosition {
  scrollTop: number;
  anchorId?: string;
  anchorOffset?: number;
}

export interface AnchoredScrollRestoreOptions {
  /** Identity of the current view; restoration re-runs when this changes. */
  key: string | null;
  /** Read the saved position for the current key (called at restore time). */
  read: () => SavedScrollPosition | undefined;
  /** Persist the current position for the current key. */
  write: (pos: SavedScrollPosition) => void;
  /**
   * Attribute on feed cards holding a stable id (e.g. `"data-feed-anchor"`).
   * When set, restoration pins to that card; omit for pixel-only behaviour.
   */
  cardAttr?: string;
  /** Disable save/restore (e.g. an inactive panel). Default true. */
  active?: boolean;
  /** How long to keep re-pinning the anchor as late media loads (ms). */
  repinDurationMs?: number;
}

/** Snapshot where the scroll container is sitting, as an anchor card + offset. */
export function captureScrollPosition(
  container: HTMLElement,
  cardAttr?: string,
): SavedScrollPosition {
  const scrollTop = container.scrollTop;
  if (!cardAttr) return { scrollTop };

  const cards = container.querySelectorAll<HTMLElement>(`[${cardAttr}]`);
  const containerTop = container.getBoundingClientRect().top;
  let anchor: { id: string; top: number } | null = null;

  // Cards are in document order: walk down until one starts below the fold top.
  // The last card starting at/above the fold top is the one the user is reading.
  for (const card of cards) {
    const id = card.getAttribute(cardAttr);
    if (!id) continue;
    const top = card.getBoundingClientRect().top - containerTop + scrollTop;
    if (top <= scrollTop + 1) {
      anchor = { id, top };
    } else {
      break;
    }
  }

  if (anchor) {
    return { scrollTop, anchorId: anchor.id, anchorOffset: scrollTop - anchor.top };
  }
  return { scrollTop };
}

/** Resolve the scrollTop that puts the saved anchor card back where it was. */
export function resolveScrollTop(
  container: HTMLElement,
  saved: SavedScrollPosition,
  cardAttr?: string,
): number {
  if (cardAttr && saved.anchorId) {
    const el = container.querySelector<HTMLElement>(
      `[${cardAttr}="${CSS.escape(saved.anchorId)}"]`,
    );
    if (el) {
      const top =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      return Math.max(0, top + (saved.anchorOffset ?? 0));
    }
  }
  return saved.scrollTop;
}

export interface AnchoredScrollRestore {
  /** Attach to the scrollable container. */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Snapshot the current position now (e.g. just before a tab switch). */
  capture: () => void;
}

export function useAnchoredScrollRestore({
  key,
  read,
  write,
  cardAttr,
  active = true,
  repinDurationMs = 3000,
}: AnchoredScrollRestoreOptions): AnchoredScrollRestore {
  const nodeRef = useRef<HTMLDivElement | null>(null);
  // Mutable mirrors so the listeners (attached once) always see fresh values.
  const readRef = useRef(read);
  const writeRef = useRef(write);
  const keyRef = useRef(key);
  const activeRef = useRef(active);
  const cardAttrRef = useRef(cardAttr);
  readRef.current = read;
  writeRef.current = write;
  activeRef.current = active;
  cardAttrRef.current = cardAttr;

  const restoringRef = useRef(false);
  const saveRaf = useRef(0);
  const repinRaf = useRef(0);
  const restoredKeyRef = useRef<string | null>(null);

  const cancelRepin = useCallback(() => {
    if (repinRaf.current) {
      cancelAnimationFrame(repinRaf.current);
      repinRaf.current = 0;
    }
  }, []);

  const doRestore = useCallback(() => {
    const el = nodeRef.current;
    if (!el || !activeRef.current) return;
    restoredKeyRef.current = keyRef.current;

    const saved = readRef.current();
    // No remembered position (first visit / unvisited tab) → start at the top
    // rather than inheriting the previous view's offset.
    if (!saved || (saved.scrollTop <= 0 && !saved.anchorId)) {
      el.scrollTop = 0;
      return;
    }

    restoringRef.current = true;
    cancelRepin();
    // Apply immediately — pre-paint when invoked from a layout effect — so the
    // feed never flashes the top before jumping.
    el.scrollTop = resolveScrollTop(el, saved, cardAttrRef.current);

    // Keep the anchor pinned while late media grows the content, then release.
    // Bail as soon as the target holds steady for a few frames (content settled)
    // instead of always burning the full window — most restores settle at once.
    let frames = 0;
    let stable = 0;
    const maxFrames = Math.max(1, Math.ceil(repinDurationMs / 16));
    const step = () => {
      const node = nodeRef.current;
      if (!node || !restoringRef.current) {
        repinRaf.current = 0;
        return;
      }
      const target = resolveScrollTop(node, saved, cardAttrRef.current);
      if (Math.abs(node.scrollTop - target) > 1) {
        node.scrollTop = target;
        stable = 0;
      } else {
        stable++;
      }
      if (stable >= REPIN_STABLE_FRAMES || ++frames >= maxFrames) {
        restoringRef.current = false;
        repinRaf.current = 0;
        return;
      }
      repinRaf.current = requestAnimationFrame(step);
    };
    repinRaf.current = requestAnimationFrame(step);
  }, [cancelRepin, repinDurationMs]);

  // Persist the position on scroll (rAF-throttled, ignored during restore).
  const onScroll = useCallback(() => {
    if (restoringRef.current || !activeRef.current || saveRaf.current) return;
    saveRaf.current = requestAnimationFrame(() => {
      saveRaf.current = 0;
      const el = nodeRef.current;
      if (el) writeRef.current(captureScrollPosition(el, cardAttrRef.current));
    });
  }, []);

  // A real user gesture ends the restore window so we stop fighting the user.
  // (Programmatic scrollTop fires "scroll" but not wheel/touch/key, so these
  // are clean signals of intent.)
  const onUserInput = useCallback(() => {
    restoringRef.current = false;
    cancelRepin();
  }, [cancelRepin]);

  // Callback ref: (re)wires listeners and restores when the container attaches —
  // including the case where it appears only after a loading spinner clears.
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      const prev = nodeRef.current;
      if (prev) {
        prev.removeEventListener("scroll", onScroll);
        prev.removeEventListener("wheel", onUserInput);
        prev.removeEventListener("touchstart", onUserInput);
        prev.removeEventListener("keydown", onUserInput);
      }
      nodeRef.current = node;
      if (!node) return;
      node.addEventListener("scroll", onScroll, { passive: true });
      node.addEventListener("wheel", onUserInput, { passive: true });
      node.addEventListener("touchstart", onUserInput, { passive: true });
      node.addEventListener("keydown", onUserInput);
      if (restoredKeyRef.current !== keyRef.current) doRestore();
    },
    [onScroll, onUserInput, doRestore],
  );

  const capture = useCallback(() => {
    const el = nodeRef.current;
    if (el && activeRef.current) {
      writeRef.current(captureScrollPosition(el, cardAttrRef.current));
    }
  }, []);

  // Restore on key change when the same container node persists (e.g. a tab
  // switch within the page). Fresh mounts go through the callback ref above.
  useLayoutEffect(() => {
    keyRef.current = key;
    if (!active) return;
    // Drop a pending save so it can't overwrite the new key with stale content.
    if (saveRaf.current) {
      cancelAnimationFrame(saveRaf.current);
      saveRaf.current = 0;
    }
    if (nodeRef.current && restoredKeyRef.current !== key) doRestore();
  }, [key, active, doRestore]);

  useEffect(
    () => () => {
      if (saveRaf.current) cancelAnimationFrame(saveRaf.current);
      cancelRepin();
    },
    [cancelRepin],
  );

  return { containerRef, capture };
}
