import { useState, useRef, useEffect } from "react";
import { Send, X } from "lucide-react";
import { useProfile } from "../../profile/useProfile";

interface ReplyComposerProps {
  targetPubkey: string;
  onSend: (content: string) => void;
  onCancel: () => void;
}

export function ReplyComposer({ targetPubkey, onSend, onCancel }: ReplyComposerProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { profile } = useProfile(targetPubkey);
  const name = profile?.display_name || profile?.name || targetPubkey.slice(0, 8) + "...";

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSend(text);
        setText("");
      }
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div className="mt-2 rounded-md border border-edge/30 bg-card-hover/30">
      <div className="flex items-center gap-1 border-l-2 border-neon px-3 pt-2 text-xs text-muted">
        <span>Replying to</span>
        <span className="text-neon">{name}</span>
      </div>
      <div className="flex items-end gap-2 p-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder="Write a reply..."
          className="flex-1 resize-none rounded-md bg-transparent px-2 py-1 text-sm text-body placeholder:text-muted focus:outline-none"
        />
        <div className="flex gap-1 pb-1">
          <button
            onClick={() => { if (text.trim()) { onSend(text); setText(""); } }}
            disabled={!text.trim()}
            className="rounded-md p-1.5 text-neon transition-colors hover:bg-neon/10 disabled:opacity-40"
          >
            <Send size={14} />
          </button>
          <button
            onClick={onCancel}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-card-hover hover:text-heading"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
