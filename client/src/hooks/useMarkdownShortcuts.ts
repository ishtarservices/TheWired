import { useEffect, type RefObject } from "react";
import { wrapSelection } from "@/lib/content/wrapSelection";

interface UseMarkdownShortcutsOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (value: string) => void;
}

interface ShortcutDef {
  key: string;
  shift?: boolean;
  marker: string;
  blockLevel?: boolean;
}

const SHORTCUTS: ShortcutDef[] = [
  { key: "b", marker: "**" },               // Cmd/Ctrl + B → Bold
  { key: "i", marker: "*" },                // Cmd/Ctrl + I → Italic
  { key: "s", shift: true, marker: "~~" },  // Cmd/Ctrl + Shift + S → Strikethrough
  { key: "e", marker: "`" },                // Cmd/Ctrl + E → Inline code
  { key: "c", shift: true, marker: "```", blockLevel: true }, // Cmd/Ctrl + Shift + C → Code block
];

/**
 * Attaches keyboard shortcuts for markdown formatting to a textarea.
 *
 * Uses native event listener (not React synthetic) so it fires before
 * the component's onKeyDown handler and can preventDefault cleanly.
 */
export function useMarkdownShortcuts({
  textareaRef,
  value,
  setValue,
}: UseMarkdownShortcutsOptions) {
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const handler = (e: KeyboardEvent) => {
      // Require Cmd (macOS) or Ctrl (other platforms)
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      const shortcut = SHORTCUTS.find(
        (s) =>
          s.key === e.key.toLowerCase() &&
          (s.shift ? e.shiftKey : !e.shiftKey),
      );
      if (!shortcut) return;

      e.preventDefault();
      e.stopPropagation();

      const { selectionStart, selectionEnd } = textarea;
      const result = wrapSelection(
        value,
        selectionStart,
        selectionEnd,
        shortcut.marker,
        shortcut.blockLevel,
      );

      setValue(result.newValue);

      // Restore cursor position after React re-renders the textarea value
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(result.newCursorStart, result.newCursorEnd);
      });
    };

    // Use capture phase so this fires before React's synthetic onKeyDown
    textarea.addEventListener("keydown", handler, { capture: true });
    return () => textarea.removeEventListener("keydown", handler, { capture: true });
  }, [textareaRef, value, setValue]);
}
