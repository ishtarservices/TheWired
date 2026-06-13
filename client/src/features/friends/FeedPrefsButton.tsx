import { useCallback, useEffect, useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { FeedPrefsPanel } from "./FeedPrefsPanel";

/** Toolbar button that opens the Feed preferences dropdown (Feed only). */
export function FeedPrefsButton({ channelType }: { channelType: string }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(wrapperRef, close, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Feed preferences"
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150 hover:bg-card hover:text-heading ${
          open ? "bg-card text-heading" : "text-soft"
        }`}
      >
        <SlidersHorizontal size={13} />
        Preferences
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5">
          <FeedPrefsPanel channelType={channelType} />
        </div>
      )}
    </div>
  );
}
