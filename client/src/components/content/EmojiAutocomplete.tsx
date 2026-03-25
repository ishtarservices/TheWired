import { useState, useEffect, useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import type { CustomEmoji } from "@/types/emoji";

interface EmojiAutocompleteProps {
  query: string;
  onSelect: (shortcode: string, url: string) => void;
  onClose: () => void;
}

/** Autocomplete dropdown for :shortcode: custom emojis */
export function EmojiAutocomplete({ query, onSelect, onClose }: EmojiAutocompleteProps) {
  const shortcodeIndex = useAppSelector((s) => s.emoji.shortcodeIndex);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter matching emojis
  const matches: CustomEmoji[] = [];
  const lowerQuery = query.toLowerCase();
  for (const [shortcode, emoji] of Object.entries(shortcodeIndex)) {
    if (shortcode.toLowerCase().includes(lowerQuery)) {
      matches.push(emoji);
      if (matches.length >= 8) break;
    }
  }

  // Reset selection when matches change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matches.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % matches.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + matches.length) % matches.length);
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          if (matches[selectedIndex]) {
            onSelect(matches[selectedIndex].shortcode, matches[selectedIndex].url);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matches, selectedIndex, onSelect, onClose]);

  if (matches.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 mb-1 w-64 max-h-48 overflow-y-auto rounded-lg border border-border bg-panel shadow-lg z-50"
    >
      {matches.map((emoji, i) => (
        <button
          key={emoji.shortcode}
          type="button"
          onClick={() => onSelect(emoji.shortcode, emoji.url)}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors ${
            i === selectedIndex
              ? "bg-primary/10 text-heading"
              : "text-body hover:bg-surface-hover"
          }`}
        >
          <img
            src={emoji.url}
            alt={`:${emoji.shortcode}:`}
            className="h-5 w-5 object-contain"
          />
          <span className="truncate">:{emoji.shortcode}:</span>
        </button>
      ))}
    </div>
  );
}
