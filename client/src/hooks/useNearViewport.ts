import { useEffect, useState, type RefObject } from "react";

/**
 * True once the referenced element is within `rootMargin` of the viewport.
 * Used to defer expensive media loads until a tile is about to be seen, so a
 * long feed doesn't load everything at once.
 *
 * Sticky by default: once near, stays true (the loaded media is kept rather than
 * thrashing on scroll). Pass `sticky: false` to also unset when it scrolls away.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  rootMargin = "400px",
  sticky = true,
): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // No IntersectionObserver (older webview / test env) → load eagerly.
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }

    let done = false;
    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
          setNear(true);
          if (sticky) {
            done = true;
            obs.disconnect();
          }
        } else if (!sticky) {
          setNear(false);
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => {
      if (!done) obs.disconnect();
    };
  }, [ref, rootMargin, sticky]);

  return near;
}
