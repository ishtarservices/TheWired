import { useState } from "react";
import { X } from "lucide-react";

interface HashtagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
  suggestions?: string[];
}

function normalizeTag(raw: string): string {
  return raw.toLowerCase().replace(/^#/, "").trim();
}

export function HashtagInput({
  value,
  onChange,
  label = "Hashtags",
  placeholder = "Type a tag and press Enter",
  suggestions,
}: HashtagInputProps) {
  const [input, setInput] = useState("");

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag) return;
    if (value.includes(tag)) return;
    onChange([...value, tag]);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-soft">
        {label}
      </label>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs text-heading"
            >
              <span>#{tag}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="text-muted hover:text-heading"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-xl border border-edge bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
        placeholder={placeholder}
      />
      {suggestions && suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addTag(s)}
                className="rounded-full border border-edge px-2 py-0.5 text-[10px] text-muted transition-colors hover:border-pulse/30 hover:text-heading"
              >
                #{s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
