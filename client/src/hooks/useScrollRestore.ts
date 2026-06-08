import { useEffect, useRef, useCallback } from "react";

/**
 * Module-level scroll position store.
 * Keyed by a caller-provided string (e.g. `${spaceId}:${channelType}`).
 * Survives component unmounts/remounts.
 */
const scrollPositions = new Map<string, number>();

/**
 * Hook that saves scroll position and restores it on mount/key-change. Attach
 * the returned ref to the scrollable container.
 *
 * Position is saved CONTINUOUSLY while scrolling (rAF-throttled), not only in an
 * unmount cleanup: React detaches object refs before passive-effect cleanups run
 * on unmount, so reading the ref there would yield null and lose the position.
 *
 * @param key - unique identifier for this scroll context (channel ID)
 * @param active - only save/restore when this panel is visible
 */
export function useScrollRestore(key: string | null, active = true) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef(key);
  const restoringRef = useRef(false);
  const saveRaf = useRef(0);

  // Restore a key's saved position. Guards the scroll-saver so the programmatic
  // scroll isn't mistaken for a user scroll and re-saved at a clamped value.
  const restorePosition = useCallback((targetKey: string) => {
    const saved = scrollPositions.get(targetKey);
    if (saved == null || !scrollRef.current) return;
    restoringRef.current = true;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved;
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
    });
  }, []);

  // Continuously persist the scroll position for the active key.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !active) return;
    const onScroll = () => {
      if (restoringRef.current || saveRaf.current) return;
      saveRaf.current = requestAnimationFrame(() => {
        saveRaf.current = 0;
        if (currentKeyRef.current && scrollRef.current) {
          scrollPositions.set(currentKeyRef.current, scrollRef.current.scrollTop);
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (saveRaf.current) cancelAnimationFrame(saveRaf.current);
    };
  }, [active]);

  // On key change (and mount): save old position, restore new position.
  useEffect(() => {
    if (!active) return;

    const prevKey = currentKeyRef.current;
    if (prevKey && prevKey !== key && scrollRef.current) {
      scrollPositions.set(prevKey, scrollRef.current.scrollTop);
    }
    currentKeyRef.current = key;
    if (key) restorePosition(key);
  }, [key, active, restorePosition]);

  return scrollRef;
}
