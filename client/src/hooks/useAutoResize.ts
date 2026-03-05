import { useEffect, type RefObject } from "react";

/**
 * Auto-resize a textarea to fit its content, up to a max height.
 * Beyond maxHeight the textarea becomes scrollable.
 */
export function useAutoResize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight = 150,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset to auto so scrollHeight reflects true content height
    el.style.height = "auto";
    const clamped = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${clamped}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [ref, value, maxHeight]);
}
