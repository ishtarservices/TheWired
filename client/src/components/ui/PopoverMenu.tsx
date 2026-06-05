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

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

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

  // Keyboard a11y: move focus into the menu on open, let Up/Down/Home/End rove
  // its items, and restore focus to the opener on close. Arrow keys are ignored
  // while focus is in a text field so the caret still works.
  useEffect(() => {
    if (!open) return;
    const menu = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const items = () =>
      menu ? Array.from(menu.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];

    const raf = window.requestAnimationFrame(() => {
      if (menu && !menu.contains(document.activeElement)) {
        (items()[0] ?? menu).focus();
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      const list = items();
      if (list.length === 0) return;
      e.preventDefault();
      const cur = list.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? list.length - 1
            : e.key === "ArrowDown"
              ? cur < 0
                ? 0
                : (cur + 1) % list.length
              : cur < 0
                ? list.length - 1
                : (cur - 1 + list.length) % list.length;
      list[next].focus();
    };

    menu?.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      menu?.removeEventListener("keydown", onKey);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [open]);

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

  // Close on scroll when using portal (the fixed position goes stale) — but NOT
  // when the user is scrolling WITHIN the menu itself (e.g. a long, scrollable
  // option list), which would otherwise dismiss it on the first wheel tick.
  useEffect(() => {
    if (!usePortal || !open) return;
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && ref.current && ref.current.contains(target)) return;
      onClose();
    };
    window.addEventListener("scroll", onScroll, { capture: true });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, [usePortal, open, onClose]);

  const menuEl = (
    <div
      ref={ref}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "w-max min-w-[160px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl card-glass py-1.5 shadow-xl outline-none transition-all duration-150",
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
  return <div className="my-1.5 border-t border-border" />;
}
