import { useCallback, type RefObject } from "react";
import { Bold, Italic, Strikethrough, Code, FileCode, EyeOff } from "lucide-react";
import { wrapSelection } from "@/lib/content/wrapSelection";

interface FormattingToolbarProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (value: string) => void;
}

interface ToolbarButton {
  icon: typeof Bold;
  marker: string;
  title: string;
  blockLevel?: boolean;
}

const BUTTONS: ToolbarButton[] = [
  { icon: Bold, marker: "**", title: "Bold (Ctrl+B)" },
  { icon: Italic, marker: "*", title: "Italic (Ctrl+I)" },
  { icon: Strikethrough, marker: "~~", title: "Strikethrough (Ctrl+Shift+S)" },
  { icon: Code, marker: "`", title: "Code (Ctrl+E)" },
  { icon: FileCode, marker: "```", title: "Code block (Ctrl+Shift+C)", blockLevel: true },
  { icon: EyeOff, marker: "||", title: "Spoiler" },
];

export function FormattingToolbar({ textareaRef, value, setValue }: FormattingToolbarProps) {
  const handleFormat = useCallback(
    (marker: string, blockLevel?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const { selectionStart, selectionEnd } = textarea;
      const result = wrapSelection(value, selectionStart, selectionEnd, marker, blockLevel);

      setValue(result.newValue);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(result.newCursorStart, result.newCursorEnd);
      });
    },
    [textareaRef, value, setValue],
  );

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-edge/30">
      {BUTTONS.map((btn) => (
        <button
          key={btn.marker}
          type="button"
          title={btn.title}
          onMouseDown={(e) => {
            // Prevent textarea blur so selection is preserved
            e.preventDefault();
            handleFormat(btn.marker, btn.blockLevel);
          }}
          className="rounded p-1 text-faint hover:text-muted hover:bg-surface-hover transition-colors"
        >
          <btn.icon size={14} />
        </button>
      ))}
    </div>
  );
}
