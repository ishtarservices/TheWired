import { useState, useCallback, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAutoResize } from "@/hooks/useAutoResize";

interface DMInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function DMInput({ onSend, disabled }: DMInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutoResize(textareaRef, value, 150);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!value.trim() || disabled) return;
      onSend(value.trim());
      setValue("");
    },
    [value, disabled, onSend],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-white/4 p-3">
      <div className="flex items-end gap-2 rounded-xl bg-white/4 px-3 py-2 ring-1 ring-white/6">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none overflow-hidden"
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
    </form>
  );
}
