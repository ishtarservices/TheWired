import { useEffect, useState, useRef, useCallback } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { profileCache } from "@/lib/nostr/profileCache";
import type { Kind0Profile } from "@/types/profile";

interface MentionAutocompleteProps {
  query: string;
  onSelect: (pubkey: string, displayName: string) => void;
  onClose: () => void;
  /** When provided, prioritize these pubkeys (e.g. space members) in results */
  scopedPubkeys?: string[];
}

interface SearchResult {
  pubkey: string;
  profile: Kind0Profile;
}

export function MentionAutocomplete({
  query,
  onSelect,
  onClose,
  scopedPubkeys,
}: MentionAutocompleteProps) {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let r: SearchResult[];
    if (scopedPubkeys?.length) {
      if (query === "") {
        // Empty query (user just typed "@"): show all scoped members
        r = scopedPubkeys.slice(0, 8).map((pk) => ({
          pubkey: pk,
          profile: profileCache.getCached(pk) ?? {},
        }));
      } else {
        r = profileCache.searchScoped(query, scopedPubkeys, 8);
      }
    } else {
      r = query === "" ? [] : profileCache.searchCached(query, 8);
    }
    setResults(r);
    setActiveIndex(0);
  }, [query, scopedPubkeys]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (results.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopImmediatePropagation();
          setActiveIndex((i) => (i + 1) % results.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopImmediatePropagation();
          setActiveIndex((i) => (i - 1 + results.length) % results.length);
          break;
        case "Enter":
        case "Tab": {
          e.preventDefault();
          e.stopImmediatePropagation();
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
          e.stopImmediatePropagation();
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

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border-light bg-panel shadow-xl"
    >
      {results.map((r, i) => {
        const name = r.profile.display_name || r.profile.name || r.pubkey.slice(0, 8);
        return (
          <button
            key={r.pubkey}
            type="button"
            className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
              i === activeIndex ? "bg-surface-hover" : "hover:bg-surface-hover"
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
    </div>
  );
}
