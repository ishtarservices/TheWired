import { useState, useRef, useEffect, useCallback } from "react";
import { Search, X, Music, Disc3, ArrowRight } from "lucide-react";
import { useMusicSearch } from "./useMusicSearch";
import { useAppDispatch } from "@/store/hooks";
import {
  setActiveDetailId,
  setMusicView,
  setSearchQuery,
} from "@/store/slices/musicSlice";
import { useAudioPlayer } from "./useAudioPlayer";
import { resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { parseTrackEvent } from "./trackParser";
import { useResolvedArtist } from "./useResolvedArtist";

function ResolvedHitArtist({ artist }: { artist: string }) {
  const resolved = useResolvedArtist(artist);
  return <>{resolved}</>;
}

export function SearchInput() {
  const { query, setQuery, results, isSearching } = useMusicSearch();
  const [focused, setFocused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dispatch = useAppDispatch();
  const { play } = useAudioPlayer();

  const hasResults = results.tracks.length > 0 || results.albums.length > 0;
  const showDropdown = focused && query.trim().length > 0;

  // Build flat list for keyboard navigation
  const flatItems: { type: "track" | "album" | "viewAll"; hit?: (typeof results.tracks)[0] }[] = [];
  for (const hit of results.tracks.slice(0, 5)) flatItems.push({ type: "track", hit });
  for (const hit of results.albums.slice(0, 3)) flatItems.push({ type: "album", hit });
  if (hasResults) flatItems.push({ type: "viewAll" });

  // Reset active index when results change
  useEffect(() => setActiveIdx(-1), [results]);

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

  const navigateToSearch = useCallback(() => {
    dispatch(setSearchQuery(query));
    dispatch(setMusicView("search"));
    setFocused(false);
  }, [dispatch, query]);

  const handleTrackClick = useCallback(
    async (hit: (typeof results.tracks)[0]) => {
      setFocused(false);
      setQuery("");
      // Resolve, parse, add to store, then play
      try {
        const [, pubkey, ...slugParts] = hit.addressable_id.split(":");
        const slug = slugParts.join(":");
        const res = await resolveMusic("track", pubkey, slug);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawEvent = (res.data as any).event;
        await processIncomingEvent(rawEvent, "search");
        const parsed = parseTrackEvent(rawEvent);
        play(parsed.addressableId);
      } catch {
        // fallback: navigate to artist detail
        const pubkey = hit.addressable_id.split(":")[1];
        dispatch(setActiveDetailId({ view: "artist-detail", id: pubkey }));
      }
    },
    [dispatch, play, setQuery],
  );

  const handleAlbumClick = useCallback(
    (hit: (typeof results.albums)[0]) => {
      setFocused(false);
      setQuery("");
      dispatch(setActiveDetailId({ view: "album-detail", id: hit.addressable_id }));
    },
    [dispatch, setQuery],
  );

  const handleSelect = useCallback(
    (idx: number) => {
      const item = flatItems[idx];
      if (!item) return;
      if (item.type === "viewAll") navigateToSearch();
      else if (item.type === "track" && item.hit) handleTrackClick(item.hit);
      else if (item.type === "album" && item.hit) handleAlbumClick(item.hit);
    },
    [flatItems, navigateToSearch, handleTrackClick, handleAlbumClick],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0) handleSelect(activeIdx);
      else navigateToSearch();
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  };

  let itemIdx = 0;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl bg-field ring-1 ring-border px-2.5 py-1.5 focus-within:ring-primary/30 focus-within:shadow-[0_0_12px_var(--focus-glow-color)] transition-all">
        <Search size={14} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search music..."
          className="w-44 bg-transparent text-sm text-heading placeholder-muted outline-none transition-all focus:w-56"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="shrink-0 text-muted hover:text-heading"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-border card-glass shadow-xl overflow-hidden">
          {isSearching && !hasResults && (
            <div className="flex items-center gap-2 px-3 py-3">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-xs text-muted">Searching...</span>
            </div>
          )}

          {results.tracks.length > 0 && (
            <div className="border-b border-border/50">
              <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Tracks
              </p>
              {results.tracks.slice(0, 5).map((hit) => {
                const idx = itemIdx++;
                return (
                  <button
                    key={hit.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleTrackClick(hit)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                      activeIdx === idx ? "bg-surface" : "hover:bg-surface/50"
                    }`}
                  >
                    {hit.image_url ? (
                      <img
                        src={hit.image_url}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card">
                        <Music size={14} className="text-muted" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-heading">
                        {hit.title || "Untitled"}
                      </p>
                      <p className="truncate text-xs text-muted">
                        <ResolvedHitArtist artist={hit.artist} />
                        {hit.genre && <> &middot; {hit.genre}</>}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {results.albums.length > 0 && (
            <div className="border-b border-border/50">
              <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                Albums
              </p>
              {results.albums.slice(0, 3).map((hit) => {
                const idx = itemIdx++;
                return (
                  <button
                    key={hit.id}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => handleAlbumClick(hit)}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                      activeIdx === idx ? "bg-surface" : "hover:bg-surface/50"
                    }`}
                  >
                    {hit.image_url ? (
                      <img
                        src={hit.image_url}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card">
                        <Disc3 size={14} className="text-muted" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-heading">
                        {hit.title || "Untitled"}
                      </p>
                      <p className="truncate text-xs text-muted">
                        <ResolvedHitArtist artist={hit.artist} />
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* View all results button */}
          {hasResults && (
            <button
              onMouseEnter={() => setActiveIdx(itemIdx)}
              onClick={navigateToSearch}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left transition-colors ${
                activeIdx === itemIdx ? "bg-surface" : "hover:bg-surface/50"
              }`}
            >
              <span className="text-xs font-medium text-primary">
                View all results
              </span>
              <ArrowRight size={12} className="text-primary" />
            </button>
          )}

          {!isSearching && !hasResults && query.trim() && (
            <p className="px-3 py-3 text-center text-xs text-muted">
              No results found
            </p>
          )}
        </div>
      )}
    </div>
  );
}
