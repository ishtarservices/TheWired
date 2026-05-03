import { useEffect, useRef, useState } from "react";
import { ZoomIn } from "lucide-react";
import { subscribeZoom } from "../lib/zoom";

const HIDE_DELAY_MS = 1100;

/**
 * Brief toast that announces the current zoom level when it changes.
 * Anchored top-center, non-interactive, screen-reader friendly.
 */
export function ZoomIndicator() {
  const [zoom, setZoom] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsub = subscribeZoom((z) => {
      setZoom(z);
      setVisible(true);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    });
    return () => {
      unsub();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  if (zoom === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed left-1/2 top-6 z-[200] flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-panel/95 px-4 py-2 text-sm font-medium text-heading shadow-lg backdrop-blur transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <ZoomIn size={14} className="text-primary" aria-hidden="true" />
      <span>{Math.round(zoom * 100)}%</span>
    </div>
  );
}
