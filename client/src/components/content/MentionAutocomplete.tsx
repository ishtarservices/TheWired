import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/ui/Avatar";
import { profileCache } from "@/lib/nostr/profileCache";
import type { Kind0Profile } from "@/types/profile";

interface MentionAutocompleteProps {
  query: string;
  anchorRect: DOMRect;
  onSelect: (pubkey: string, displayName: string) => void;
  onClose: () => void;
}

interface SearchResult {
  pubkey: string;
  profile: Kind0Profile;
}

export function MentionAutocomplete({
  query,
  anchorRect,
  onSelect,
  onClose,
}: MentionAutocompleteProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const r = profileCache.searchCached(query, 8);
    setResults(r);
    setActiveIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % results.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + results.length) % results.length);
          break;
        case "Enter":
        case "Tab": {
          e.preventDefault();
          const selected = results[activeIndex];
          if (selected) {
            const name =
              selected.profile.display_name ||
              selected.profile.name ||
              selected.pubkey.slice(0, 8);
            onSelect(selected.pubkey, name);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [results, activeIndex, onSelect, onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[activeIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (results.length === 0) return null;

  // Position above the anchor (caret position)
  const top = anchorRect.top - 4;
  const left = anchorRect.left;

  return createPortal(
    <div
      ref={listRef}
      className="fixed z-50 max-h-64 w-72 overflow-y-auto rounded-lg border border-white/[0.08] bg-surface shadow-xl"
      style={{
        bottom: window.innerHeight - top,
        left: Math.min(left, window.innerWidth - 300),
      }}
    >
      {results.map((r, i) => {
        const name = r.profile.display_name || r.profile.name || r.pubkey.slice(0, 8);
        return (
          <button
            key={r.pubkey}
            type="button"
            className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
              i === activeIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
            }`}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault(); // Don't blur textarea
              onSelect(r.pubkey, name);
            }}
          >
            <Avatar src={r.profile.picture} alt={name} size="xs" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-heading">{name}</div>
              {r.profile.name && r.profile.display_name && (
                <div className="truncate text-xs text-muted">@{r.profile.name}</div>
              )}
            </div>
            {r.profile.nip05 && (
              <span className="truncate text-xs text-faint max-w-[100px]">
                {r.profile.nip05}
              </span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
