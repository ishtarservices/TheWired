import { useEffect, useRef } from "react";

interface RevealSentinelProps {
  /** Called when the sentinel scrolls within ~1000px of the viewport. */
  onReach: () => void;
}

/**
 * Invisible end-of-list marker. Fires `onReach` when scrolled within ~1000px of
 * it — used by feeds to grow their rendered window (and, once everything fetched
 * is shown, to fetch more). Shared by MediaFeed and NotesFeed.
 */
export function RevealSentinel({ onReach }: RevealSentinelProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onReach();
      },
      { rootMargin: "1000px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [onReach]);
  return <div ref={ref} className="h-1" />;
}
