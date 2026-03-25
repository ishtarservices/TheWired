import { useState, useRef, useCallback, useEffect } from "react";
import { Search, Heart, X, TrendingUp, Clock } from "lucide-react";
import { useGifSearch } from "@/hooks/useGifSearch";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { store } from "@/store";
import { addFavorite, removeFavorite, addRecent } from "@/store/slices/gifSlice";
import { saveGifFavorites, saveGifRecents } from "@/features/chat/gifPersistence";
import type { GifItem } from "@/types/emoji";

type Tab = "trending" | "search" | "favorites";

interface GifPickerProps {
  onSelect: (gif: GifItem) => void;
  onClose: () => void;
}

export function GifPicker({ onSelect, onClose }: GifPickerProps) {
  const [activeTab, setActiveTab] = useState<Tab>("trending");
  const { query, setQuery, results, loading, hasMore, loadMore } = useGifSearch();
  const favorites = useAppSelector((s) => s.gif.favorites);
  const recents = useAppSelector((s) => s.gif.recents);
  const dispatch = useAppDispatch();
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load trending on mount
  useEffect(() => {
    setQuery("");
  }, [setQuery]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSelect = useCallback(
    (gif: GifItem) => {
      dispatch(addRecent(gif));
      // Persist async
      const state = { ...gif };
      saveGifRecents([state]).catch(() => {});
      onSelect(gif);
    },
    [dispatch, onSelect],
  );

  const toggleFavorite = useCallback(
    (gif: GifItem, e: React.MouseEvent) => {
      e.stopPropagation();
      const isFav = favorites.some((f) => f.id === gif.id);
      if (isFav) {
        dispatch(removeFavorite(gif.id));
      } else {
        dispatch(addFavorite(gif));
      }
      // Persist async — read fresh state after Redux update
      setTimeout(() => {
        saveGifFavorites(store.getState().gif.favorites).catch(() => {});
      }, 0);
    },
    [favorites, dispatch],
  );

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore || activeTab === "favorites") return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
      loadMore();
    }
  }, [loading, hasMore, loadMore, activeTab]);

  const handleSearchInput = (value: string) => {
    setQuery(value);
    if (value.trim()) {
      setActiveTab("search");
    } else {
      setActiveTab("trending");
    }
  };

  const displayGifs = activeTab === "favorites" ? favorites : results;

  return (
    <div className="absolute bottom-full left-0 mb-2 w-[360px] max-h-[420px] flex flex-col rounded-xl border border-border bg-panel shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="flex-1 flex items-center gap-2 rounded-lg bg-field px-2.5 py-1.5 ring-1 ring-border">
          <Search size={14} className="text-muted shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search GIFs..."
            className="flex-1 bg-transparent text-sm text-heading placeholder:text-muted outline-none"
            autoFocus
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                setActiveTab("trending");
                searchInputRef.current?.focus();
              }}
              className="text-muted hover:text-heading"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pb-2">
        <TabButton
          active={activeTab === "trending"}
          onClick={() => { setActiveTab("trending"); setQuery(""); }}
          icon={<TrendingUp size={12} />}
          label="Trending"
        />
        <TabButton
          active={activeTab === "favorites"}
          onClick={() => setActiveTab("favorites")}
          icon={<Heart size={12} />}
          label={`Favorites (${favorites.length})`}
        />
        {recents.length > 0 && activeTab !== "search" && (
          <TabButton
            active={false}
            onClick={() => {
              // Show recents inline -- could be a separate tab, but keep it simple
            }}
            icon={<Clock size={12} />}
            label="Recent"
          />
        )}
      </div>

      {/* Grid */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 pb-2"
      >
        {displayGifs.length === 0 && !loading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted">
            {activeTab === "favorites"
              ? "No favorites yet. Click the heart on any GIF to save it."
              : "No GIFs found."}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          {displayGifs.map((gif) => (
            <button
              key={gif.id}
              type="button"
              onClick={() => handleSelect(gif)}
              className="group relative rounded-lg overflow-hidden bg-surface-hover hover:ring-2 hover:ring-primary/50 transition-all cursor-pointer"
              style={{
                aspectRatio: gif.width && gif.height ? `${gif.width}/${gif.height}` : "4/3",
              }}
            >
              <img
                src={gif.previewUrl}
                alt={gif.title}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={(e) => toggleFavorite(gif, e)}
                className="absolute top-1 right-1 rounded-full bg-black/50 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Heart
                  size={12}
                  className={
                    favorites.some((f) => f.id === gif.id)
                      ? "fill-red-400 text-red-400"
                      : "text-white"
                  }
                />
              </button>
            </button>
          ))}
        </div>
        {loading && (
          <div className="flex justify-center py-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        )}
      </div>

      {/* Attribution */}
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-faint text-center">
        Powered by Tenor
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-primary/15 text-primary"
          : "text-muted hover:text-heading hover:bg-surface-hover"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
