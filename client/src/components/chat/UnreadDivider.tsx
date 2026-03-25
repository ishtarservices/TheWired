import { useEffect, useState, forwardRef } from "react";

interface UnreadDividerProps {
  /** Auto-fade after this many ms. 0 = never fade. */
  fadeAfterMs?: number;
  onFaded?: () => void;
}

export const UnreadDivider = forwardRef<HTMLDivElement, UnreadDividerProps>(
  function UnreadDivider({ fadeAfterMs = 8_000, onFaded }, ref) {
    const [fading, setFading] = useState(false);

    useEffect(() => {
      if (!fadeAfterMs) return;
      const timer = setTimeout(() => {
        setFading(true);
        // Wait for CSS transition to finish before notifying parent
        const cleanup = setTimeout(() => onFaded?.(), 500);
        return () => clearTimeout(cleanup);
      }, fadeAfterMs);
      return () => clearTimeout(timer);
    }, [fadeAfterMs, onFaded]);

    return (
      <div
        ref={ref}
        className={`flex items-center gap-3 px-5 py-1.5 transition-opacity duration-500 ${fading ? "opacity-0" : "opacity-100"}`}
      >
        <div className="h-px flex-1 bg-primary/40" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/70">
          New messages
        </span>
        <div className="h-px flex-1 bg-primary/40" />
      </div>
    );
  },
);
