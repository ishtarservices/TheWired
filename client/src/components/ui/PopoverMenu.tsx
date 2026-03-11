import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { useClickOutside } from "../../hooks/useClickOutside";

interface PopoverMenuProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  position?: "above" | "below";
  /** When provided, renders via portal with fixed positioning anchored to this element */
  anchorRef?: RefObject<HTMLElement | null>;
}

export function PopoverMenu({ open, onClose, children, position = "above", anchorRef }: PopoverMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<React.CSSProperties>({});
  const usePortal = !!anchorRef;
  useClickOutside(ref, onClose, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Compute fixed position from anchor element when using portal mode.
  // Measures the menu after render and flips above/below if it would overflow.
  useLayoutEffect(() => {
    if (!usePortal || !open || !anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuHeight = ref.current?.offsetHeight ?? 300;
    const gap = 4;
    const style: React.CSSProperties = {};

    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    const preferBelow = position === "below";
    const fitsBelow = menuHeight <= spaceBelow;
    const fitsAbove = menuHeight <= spaceAbove;

    // Place below if preferred and fits, or if above doesn't fit either but below has more room
    const placeBelow = preferBelow
      ? (fitsBelow || !fitsAbove)
      : (!fitsAbove && fitsBelow);

    if (placeBelow) {
      // Clamp so menu doesn't overflow bottom
      const top = rect.bottom + gap;
      style.top = Math.min(top, window.innerHeight - menuHeight - 8);
    } else {
      // Clamp so menu doesn't overflow top
      const bottom = window.innerHeight - rect.top + gap;
      style.bottom = Math.min(bottom, window.innerHeight - 8);
    }

    // Anchor right edge to the anchor's right edge
    const rightOffset = window.innerWidth - rect.right;
    if (rightOffset + 160 > window.innerWidth) {
      style.left = rect.left;
    } else {
      style.right = rightOffset;
    }
    setCoords(style);
  }, [open, usePortal, anchorRef, position]);

  // Close on scroll when using portal (fixed position goes stale)
  useEffect(() => {
    if (!usePortal || !open) return;
    const onScroll = () => onClose();
    window.addEventListener("scroll", onScroll, { capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [usePortal, open, onClose]);

  const menuEl = (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "w-max min-w-[160px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl card-glass py-1.5 shadow-xl transition-all duration-150",
        usePortal ? "fixed z-50" : "absolute right-0 z-40",
        !usePortal && (position === "above" ? "bottom-full mb-1" : "top-full mt-1"),
        open
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-1 pointer-events-none",
      )}
      style={usePortal ? coords : undefined}
    >
      {children}
    </div>
  );

  if (usePortal) {
    return createPortal(menuEl, document.body);
  }
  return menuEl;
}

interface PopoverMenuItemProps {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
}

export function PopoverMenuItem({
  icon,
  label,
  onClick,
  variant = "default",
}: PopoverMenuItemProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg mx-1 px-3.5 py-2.5 text-sm transition-colors",
        variant === "danger"
          ? "text-red-400 hover:bg-red-500/10"
          : "text-body hover:bg-surface-hover hover:text-heading",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function PopoverMenuSeparator() {
  return <div className="my-1.5 border-t border-edge" />;
}
