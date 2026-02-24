import { useEffect, useRef, useCallback } from "react";

/**
 * Module-level scroll position store.
 * Keyed by a caller-provided string (e.g. `${spaceId}:${channelType}`).
 * Survives component unmounts/remounts.
 */
const scrollPositions = new Map<string, number>();

/**
 * Hook that saves scroll position on unmount/key-change and restores it on
 * mount/key-change. Attach the returned ref to the scrollable container.
 *
 * @param key - unique identifier for this scroll context (channel ID)
 * @param active - only save/restore when this panel is visible
 */
export function useScrollRestore(key: string | null, active = true) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentKeyRef = useRef(key);

  // Save current scroll position for the current key
  const savePosition = useCallback(() => {
    if (currentKeyRef.current && scrollRef.current) {
      scrollPositions.set(currentKeyRef.current, scrollRef.current.scrollTop);
    }
  }, []);

  // Restore scroll position for a key
  const restorePosition = useCallback((targetKey: string) => {
    const saved = scrollPositions.get(targetKey);
    if (saved != null && scrollRef.current) {
      // Use rAF to ensure DOM has rendered before scrolling
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = saved;
        }
      });
    }
  }, []);

  // On key change: save old position, restore new position
  useEffect(() => {
    if (!active) return;

    const prevKey = currentKeyRef.current;

    // Save previous key's position
    if (prevKey && prevKey !== key && scrollRef.current) {
      scrollPositions.set(prevKey, scrollRef.current.scrollTop);
    }

    currentKeyRef.current = key;

    // Restore new key's position
    if (key) {
      restorePosition(key);
    }
  }, [key, active, restorePosition]);

  // On unmount: save current position
  useEffect(() => {
    return () => {
      savePosition();
    };
  }, [savePosition]);

  return scrollRef;
}
