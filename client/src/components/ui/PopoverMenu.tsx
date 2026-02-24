import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
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

  // Compute fixed position from anchor element when using portal mode
  useLayoutEffect(() => {
    if (!usePortal || !open || !anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const style: React.CSSProperties = {};
    if (position === "below") {
      style.top = rect.bottom + 4;
    } else {
      style.bottom = window.innerHeight - rect.top + 4;
    }
    // Anchor right edge to the anchor's right edge
    const rightOffset = window.innerWidth - rect.right;
    // If menu would overflow left edge, flip to left-anchored
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
      className={clsx(
        "w-max min-w-[160px] rounded-lg glass-panel py-1 shadow-xl transition-all duration-150",
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
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
        variant === "danger"
          ? "text-red-400 hover:bg-red-500/10"
          : "text-body hover:bg-card-hover/50 hover:text-heading",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function PopoverMenuSeparator() {
  return <div className="my-1 border-t border-edge/50" />;
}
