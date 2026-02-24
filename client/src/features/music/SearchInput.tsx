import { useState, useRef, useEffect } from "react";
import { Search, X, Music, Disc3 } from "lucide-react";
import { useMusicSearch } from "./useMusicSearch";

export function SearchInput() {
  const { query, setQuery, results, isSearching } = useMusicSearch();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasResults = results.tracks.length > 0 || results.albums.length > 0;
  const showDropdown = focused && query.trim() && (hasResults || isSearching);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-md border border-edge bg-field px-2 py-1 focus-within:border-heading/50">
        <Search size={14} className="text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search music..."
          className="w-40 bg-transparent text-sm text-heading placeholder-muted outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-muted hover:text-heading"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-edge bg-panel shadow-lg">
          {isSearching && (
            <p className="px-3 py-2 text-xs text-muted">Searching...</p>
          )}
          {results.tracks.length > 0 && (
            <div>
              <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Tracks
              </p>
              {results.tracks.map((hit) => {
                const title = hit.tags.find((t) => t[0] === "title")?.[1] ?? "Untitled";
                return (
                  <div
                    key={hit.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-soft hover:bg-card-hover/30"
                  >
                    <Music size={14} className="shrink-0 text-muted" />
                    <span className="truncate">{title}</span>
                  </div>
                );
              })}
            </div>
          )}
          {results.albums.length > 0 && (
            <div>
              <p className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Albums
              </p>
              {results.albums.map((hit) => {
                const title = hit.tags.find((t) => t[0] === "title")?.[1] ?? "Untitled";
                return (
                  <div
                    key={hit.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-soft hover:bg-card-hover/30"
                  >
                    <Disc3 size={14} className="shrink-0 text-muted" />
                    <span className="truncate">{title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
