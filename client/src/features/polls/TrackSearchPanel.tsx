import { useEffect, useRef } from "react";
import { Music, Loader2, Search, X } from "lucide-react";
import { useMusicSearch, type MusicSearchHit } from "../music/useMusicSearch";

interface TrackSearchPanelProps {
  onSelect: (hit: MusicSearchHit) => void;
  onClose: () => void;
}

/**
 * Inline track search for attaching a track to a poll option. Renders in-flow
 * (expands the composer and pushes content down) rather than as an overlay —
 * an absolutely-positioned dropdown inside the options scrollport got clipped
 * and covered the neighboring inputs.
 */
export function TrackSearchPanel({ onSelect, onClose }: TrackSearchPanelProps) {
  const { query, setQuery, results, isSearching } = useMusicSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Reveal the panel inside the options scrollport and focus the input
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    inputRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="mt-2 rounded-xl border border-border bg-card/60 p-2.5"
    >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-field px-3 py-2 ring-1 ring-border focus-within:ring-primary/40">
          <Search size={14} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            placeholder="Search the music library..."
            className="w-full bg-transparent text-sm text-heading placeholder:text-muted focus:outline-none"
          />
          {isSearching && (
            <Loader2 size={14} className="shrink-0 animate-spin text-muted" />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-2 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          title="Close search"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-1.5 max-h-60 overflow-y-auto">
        {results.tracks.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted">
            {query.trim()
              ? isSearching
                ? "Searching..."
                : "No tracks found"
              : "Type to search tracks by title, artist, or genre"}
          </p>
        ) : (
          results.tracks.map((hit) => (
            <button
              key={hit.addressable_id}
              type="button"
              onClick={() => onSelect(hit)}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-hover transition-colors"
            >
              {hit.image_url ? (
                <img
                  src={hit.image_url}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-border"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-card">
                  <Music size={14} className="text-muted" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-heading">{hit.title}</span>
                <span className="block truncate text-xs text-soft">{hit.artist}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
