import { useState, useRef, useCallback, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { npubEncode, decode } from "nostr-tools/nip19";
import { Button } from "../../components/ui/Button";
import { MentionAutocomplete } from "../../components/content/MentionAutocomplete";

interface ChatInputProps {
  onSend: (content: string, mentionPubkeys: string[]) => void;
  disabled?: boolean;
}

/** Match @query at cursor position — preceded by start-of-string or whitespace */
function detectMentionQuery(value: string, cursorPos: number): string | null {
  const before = value.slice(0, cursorPos);
  const match = before.match(/(^|\s)@(\w*)$/);
  return match ? match[2] : null;
}

/** Get a caret pixel position using a hidden mirror element */
function getCaretRect(textarea: HTMLTextAreaElement, cursorPos: number): DOMRect {
  const mirror = document.createElement("div");
  const style = window.getComputedStyle(textarea);

  // Copy relevant styles
  for (const prop of ["font", "padding", "border", "lineHeight", "letterSpacing", "wordSpacing"] as const) {
    mirror.style.setProperty(prop, style.getPropertyValue(prop === "font" ? "font" : prop));
  }
  mirror.style.font = style.font;
  mirror.style.padding = style.padding;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.width = `${textarea.clientWidth}px`;

  const text = textarea.value.slice(0, cursorPos);
  mirror.textContent = text;

  const span = document.createElement("span");
  span.textContent = "|";
  mirror.appendChild(span);

  document.body.appendChild(mirror);
  const spanRect = span.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  document.body.removeChild(mirror);

  return new DOMRect(
    textareaRect.left + spanRect.left - mirror.getBoundingClientRect().left,
    textareaRect.top + spanRect.top - mirror.getBoundingClientRect().top,
    0,
    spanRect.height,
  );
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [caretRect, setCaretRect] = useState<DOMRect | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const updateMentionState = useCallback((val: string, cursor: number) => {
    const query = detectMentionQuery(val, cursor);
    setMentionQuery(query);
    if (query !== null && textareaRef.current) {
      setCaretRect(getCaretRect(textareaRef.current, cursor));
    }
  }, []);

  const handleSelect = useCallback(
    (pubkey: string, _displayName: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const after = value.slice(cursor);

      // Find the @ trigger
      const match = before.match(/(^|\s)@\w*$/);
      if (!match) return;

      const prefix = before.slice(0, match.index! + match[1].length);
      const npub = npubEncode(pubkey);
      const newValue = `${prefix}nostr:${npub} ${after}`;
      setValue(newValue);
      setMentionQuery(null);

      // Restore focus and cursor position
      requestAnimationFrame(() => {
        textarea.focus();
        const newCursor = prefix.length + 6 + npub.length + 1; // "nostr:" + npub + " "
        textarea.setSelectionRange(newCursor, newCursor);
      });
    },
    [value],
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;

    // Extract mentioned pubkeys from nostr:npub1... patterns
    const mentionPubkeys: string[] = [];
    const npubPattern = /nostr:npub1[a-z0-9]+/g;
    let m;
    while ((m = npubPattern.exec(value)) !== null) {
      try {
        const decoded = decode(m[0].replace("nostr:", ""));
        if (decoded.type === "npub") {
          mentionPubkeys.push(decoded.data as string);
        }
      } catch {
        // Invalid npub, skip
      }
    }

    onSend(value.trim(), mentionPubkeys);
    setValue("");
    setMentionQuery(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let autocomplete handle these keys when open
    if (mentionQuery !== null) {
      if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
        return; // Autocomplete's document listener handles it
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-white/[0.04] p-3">
      <div className="flex items-end gap-2 rounded-xl bg-white/[0.04] px-3 py-2 ring-1 ring-white/[0.06]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            updateMentionState(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={(e) => {
            updateMentionState(value, e.currentTarget.selectionStart);
          }}
          onClick={(e) => {
            updateMentionState(value, e.currentTarget.selectionStart);
          }}
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none focus:ring-pulse/30 focus:shadow-[0_0_12px_rgba(139,92,246,0.1)]"
        />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={!value.trim() || disabled}
        >
          <Send size={16} />
        </Button>
      </div>

      {mentionQuery !== null && caretRect && (
        <MentionAutocomplete
          query={mentionQuery}
          anchorRect={caretRect}
          onSelect={handleSelect}
          onClose={() => setMentionQuery(null)}
        />
      )}
    </form>
  );
}
