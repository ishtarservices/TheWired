import { useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  addTracks,
  addAlbums,
  setExploreGenres,
  setExplorePopularTags,
  setActiveGenre,
  setActiveTag,
  setExploreResults,
  setExploreAlbumResults,
  setExploreSort,
  setExploreTab,
  setExploreLoading,
} from "@/store/slices/musicSlice";
import { getGenres, getPopularTags, browseMusic, browseAlbums } from "@/lib/api/music";
import { putEvents } from "@/lib/db/eventStore";
import type { NostrEvent } from "@/types/nostr";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { GenreCard } from "../GenreCard";
import { TrackCard } from "../TrackCard";
import { AlbumCard } from "../AlbumCard";

export function ExploreMusic() {
  const dispatch = useAppDispatch();
  const explore = useAppSelector((s) => s.music.explore);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);

  // Load genres and popular tags on mount
  useEffect(() => {
    getGenres()
      .then((res) => dispatch(setExploreGenres(res.data)))
      .catch(() => {});
    getPopularTags()
      .then((res) => dispatch(setExplorePopularTags(res.data)))
      .catch(() => {});
  }, [dispatch]);

  const loadBrowseTracks = useCallback(
    async (genre: string | null, tag: string | null, sort: "trending" | "recent" | "plays") => {
      const effectiveSort = (!genre && !tag && sort === "trending") ? "recent" : sort;
      dispatch(setExploreLoading(true));
      try {
        const res = await browseMusic({
          genre: genre ?? undefined,
          tag: tag ?? undefined,
          sort: effectiveSort,
          limit: 24,
        });
        const rawEvents = res.data.tracks;
        const parsed = rawEvents.map((evt: any) => parseTrackEvent(evt));
        dispatch(addTracks(parsed));
        dispatch(setExploreResults(parsed.map((t) => t.addressableId)));
        // Persist raw events to IndexedDB so they survive app restart
        putEvents(rawEvents as NostrEvent[]).catch(() => {});
      } catch {
        dispatch(setExploreResults([]));
      } finally {
        dispatch(setExploreLoading(false));
      }
    },
    [dispatch],
  );

  const loadBrowseAlbums = useCallback(
    async (genre: string | null, tag: string | null) => {
      dispatch(setExploreLoading(true));
      try {
        const res = await browseAlbums({
          genre: genre ?? undefined,
          tag: tag ?? undefined,
          sort: "recent",
          limit: 24,
        });
        const rawAlbumEvents = res.data.albums;
        const parsed = rawAlbumEvents.map((evt: any) => parseAlbumEvent(evt));
        dispatch(addAlbums(parsed));
        dispatch(setExploreAlbumResults(parsed.map((a) => a.addressableId)));
        // Persist raw events to IndexedDB so they survive app restart
        putEvents(rawAlbumEvents as NostrEvent[]).catch(() => {});
      } catch {
        dispatch(setExploreAlbumResults([]));
      } finally {
        dispatch(setExploreLoading(false));
      }
    },
    [dispatch],
  );

  // Reload on filter/sort/tab changes
  useEffect(() => {
    if (explore.browseTab === "albums") {
      loadBrowseAlbums(explore.activeGenre, explore.activeTag);
    } else {
      loadBrowseTracks(explore.activeGenre, explore.activeTag, explore.browseSort);
    }
  }, [explore.activeGenre, explore.activeTag, explore.browseSort, explore.browseTab, loadBrowseTracks, loadBrowseAlbums]);

  const handleGenreClick = (genre: string) => {
    dispatch(setActiveGenre(explore.activeGenre === genre ? null : genre));
  };

  const handleTagClick = (tag: string) => {
    dispatch(setActiveTag(explore.activeTag === tag ? null : tag));
  };

  const sortOptions: { value: "trending" | "recent" | "plays"; label: string }[] = [
    { value: "trending", label: "Trending" },
    { value: "recent", label: "Recent" },
    { value: "plays", label: "Most Played" },
  ];

  const browseTrackIds = explore.browseResults;
  const browseTracks = browseTrackIds.map((id) => tracks[id]).filter(Boolean);
  const browseAlbumIds = explore.browseAlbumResults;
  const browseAlbumList = browseAlbumIds.map((id) => albums[id]).filter(Boolean);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="mb-4 text-lg font-semibold text-heading">Explore</h2>

      {/* Genre cards */}
      {explore.genres.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-soft">Genres</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {explore.genres.map((g) => (
              <GenreCard
                key={g.genre}
                genre={g.genre}
                count={g.count}
                isActive={explore.activeGenre === g.genre}
                onClick={() => handleGenreClick(g.genre)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Popular tags */}
      {explore.popularTags.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-medium text-soft">Popular Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {explore.popularTags.map((t) => (
              <button
                key={t.tag}
                onClick={() => handleTagClick(t.tag)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                  explore.activeTag === t.tag
                    ? "bg-pulse/20 text-heading ring-1 ring-pulse/40"
                    : "bg-card text-soft hover:bg-card-hover hover:text-heading"
                }`}
              >
                #{t.tag}
                <span className="ml-1 text-muted">{t.count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Active filters bar */}
      {(explore.activeGenre || explore.activeTag) && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-muted">Filtering:</span>
          {explore.activeGenre && (
            <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs text-heading">
              {explore.activeGenre}
              <button
                onClick={() => dispatch(setActiveGenre(null))}
                className="text-muted hover:text-heading"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {explore.activeTag && (
            <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-xs text-heading">
              #{explore.activeTag}
              <button
                onClick={() => dispatch(setActiveTag(null))}
                className="text-muted hover:text-heading"
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Tab switcher + sort */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1">
          <button
            onClick={() => dispatch(setExploreTab("tracks"))}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              explore.browseTab === "tracks"
                ? "bg-pulse/15 text-heading"
                : "text-soft hover:text-heading"
            }`}
          >
            Tracks
          </button>
          <button
            onClick={() => dispatch(setExploreTab("albums"))}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              explore.browseTab === "albums"
                ? "bg-pulse/15 text-heading"
                : "text-soft hover:text-heading"
            }`}
          >
            Albums
          </button>
        </div>
        {explore.browseTab === "tracks" && (
          <div className="flex gap-1">
            {sortOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => dispatch(setExploreSort(opt.value))}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  explore.browseSort === opt.value
                    ? "bg-pulse/15 text-heading"
                    : "text-soft hover:text-heading"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Results grid */}
      {explore.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
        </div>
      ) : explore.browseTab === "tracks" ? (
        browseTracks.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {browseTracks.map((track, i) => (
              <TrackCard
                key={track.addressableId}
                track={track}
                queueTracks={browseTrackIds}
                queueIndex={i}
              />
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-soft">
            {explore.activeGenre || explore.activeTag
              ? "No tracks found for the selected filters."
              : "No tracks uploaded yet."}
          </p>
        )
      ) : browseAlbumList.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {browseAlbumList.map((album) => (
            <AlbumCard key={album.addressableId} album={album} />
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-soft">
          {explore.activeGenre || explore.activeTag
            ? "No albums found for the selected filters."
            : "No albums uploaded yet."}
        </p>
      )}
    </div>
  );
}
