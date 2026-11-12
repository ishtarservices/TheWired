import { useEffect, useCallback, useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
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
  setExploreLoading,
} from "@/store/slices/musicSlice";
import { getGenres, getPopularTags, browseMusic, browseAlbums, resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { store } from "@/store";
import { TrackCard } from "../TrackCard";
import { AlbumCard } from "../AlbumCard";
import { mixExplore } from "../exploreMix";

type ExploreShow = "all" | "projects" | "tracks";

const SHOW_OPTIONS: { value: ExploreShow; label: string }[] = [
  { value: "all", label: "All" },
  { value: "projects", label: "Projects" },
  { value: "tracks", label: "Tracks" },
];

const SORT_OPTIONS: { value: "trending" | "recent" | "plays"; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "trending", label: "Trending" },
  { value: "plays", label: "Most played" },
];

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(164px,1fr))] gap-x-5 gap-y-8";

/**
 * Explore is a wall of covers: projects and loose tracks together, newest
 * first. Genres and tags are filters, not content, so they sit behind the
 * Filter control and only the ones in use show on the page.
 */
export function ExploreMusic() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const dispatch = useAppDispatch();
  const explore = useAppSelector((s) => s.music.explore);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const [show, setShow] = useState<ExploreShow>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Load genres and popular tags on mount
  useEffect(() => {
    getGenres()
      .then((res) => dispatch(setExploreGenres(res.data)))
      .catch(() => {});
    getPopularTags()
      .then((res) => dispatch(setExplorePopularTags(res.data)))
      .catch(() => {});
  }, [dispatch]);

  const loadTracks = useCallback(
    async (genre: string | null, tag: string | null, sort: "trending" | "recent" | "plays") => {
      try {
        const res = await browseMusic({
          genre: genre ?? undefined,
          tag: tag ?? undefined,
          sort,
          limit: 24,
        });
        const rawEvents = res.data.tracks;
        const parsed = rawEvents.map((evt: any) => parseTrackEvent(evt));
        dispatch(addTracks(parsed));
        dispatch(setExploreResults(parsed.map((t) => t.addressableId)));
        // Process through pipeline for proper dedup, deletion checks, and IndexedDB persistence
        for (const evt of rawEvents) {
          processIncomingEvent(evt, "browse").catch(() => {});
        }

        // Resolve missing parent albums so TrackCard can display album names
        const currentAlbums = store.getState().music.albums;
        const missingAlbumRefs = new Set<string>();
        for (const t of parsed) {
          if (t.albumRef && !currentAlbums[t.albumRef]) {
            missingAlbumRefs.add(t.albumRef);
          }
        }
        for (const ref of missingAlbumRefs) {
          // albumRef format: "33123:pubkey:slug"
          const parts = ref.split(":");
          if (parts.length >= 3) {
            const [, pubkey, ...slugParts] = parts;
            resolveMusic("album", pubkey, slugParts.join(":"))
              .then((albumRes) => {
                const albumEvt = (albumRes.data as { event: any }).event;
                if (albumEvt) {
                  const albumParsed = parseAlbumEvent(albumEvt);
                  dispatch(addAlbums([albumParsed]));
                  processIncomingEvent(albumEvt, "browse").catch(() => {});
                }
              })
              .catch(() => {});
          }
        }
      } catch {
        dispatch(setExploreResults([]));
      }
    },
    [dispatch],
  );

  const loadAlbums = useCallback(
    async (genre: string | null, tag: string | null) => {
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
        // Process through pipeline for proper dedup, deletion checks, and IndexedDB persistence
        for (const evt of rawAlbumEvents) {
          processIncomingEvent(evt, "browse").catch(() => {});
        }
      } catch {
        dispatch(setExploreAlbumResults([]));
      }
    },
    [dispatch],
  );

  // The wall mixes both, so both load together whenever a filter or the sort
  // changes. A newer load supersedes an older one's "finished" signal.
  useEffect(() => {
    let current = true;
    dispatch(setExploreLoading(true));
    void Promise.all([
      loadTracks(explore.activeGenre, explore.activeTag, explore.browseSort),
      loadAlbums(explore.activeGenre, explore.activeTag),
    ]).finally(() => {
      if (current) dispatch(setExploreLoading(false));
    });
    return () => {
      current = false;
    };
  }, [explore.activeGenre, explore.activeTag, explore.browseSort, loadTracks, loadAlbums, dispatch]);

  const browseTrackIds = explore.browseResults;
  const browseTracks = useMemo(
    () => browseTrackIds.map((id) => tracks[id]).filter(Boolean),
    [browseTrackIds, tracks],
  );
  const browseAlbumList = useMemo(
    () => explore.browseAlbumResults.map((id) => albums[id]).filter(Boolean),
    [explore.browseAlbumResults, albums],
  );
  const mixed = useMemo(() => mixExplore(browseAlbumList, browseTracks), [browseAlbumList, browseTracks]);
  // Playing a loose track on the wall queues the other loose tracks after it.
  const mixedTrackIds = useMemo(
    () => mixed.filter((i) => i.kind === "track").map((i) => i.id),
    [mixed],
  );

  const activeFilterCount = (explore.activeGenre ? 1 : 0) + (explore.activeTag ? 1 : 0);
  const hasFilters = explore.genres.length > 0 || explore.popularTags.length > 0;
  const count =
    show === "all" ? mixed.length : show === "projects" ? browseAlbumList.length : browseTracks.length;
  const noun = show === "projects" ? "projects" : show === "tracks" ? "tracks" : "releases";

  const chip = (active: boolean) =>
    `rounded-full px-2.5 py-1 text-xs transition-colors ${
      active
        ? "bg-heading text-background"
        : "text-soft hover:bg-surface-hover hover:text-heading"
    }`;

  return (
    <div className={`flex-1 overflow-y-auto px-8 py-7 ${scrollPaddingClass}`}>
      <header className="mb-7 flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-heading">Explore</h1>

        <div role="tablist" aria-label="Show" className="flex items-center gap-4 text-[13px]">
          {SHOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="tab"
              aria-selected={show === opt.value}
              onClick={() => setShow(opt.value)}
              className={`rounded-sm transition-colors ${
                show === opt.value ? "font-medium text-heading" : "text-muted hover:text-heading"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Filters in use stay on the page; the rest live behind Filter. */}
        {explore.activeGenre && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs text-heading">
            {explore.activeGenre}
            <button
              onClick={() => dispatch(setActiveGenre(null))}
              className="rounded-full p-0.5 text-muted hover:bg-surface-hover hover:text-heading"
              aria-label={`Remove ${explore.activeGenre} filter`}
            >
              <X size={12} />
            </button>
          </span>
        )}
        {explore.activeTag && (
          <span className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs text-heading">
            #{explore.activeTag}
            <button
              onClick={() => dispatch(setActiveTag(null))}
              className="rounded-full p-0.5 text-muted hover:bg-surface-hover hover:text-heading"
              aria-label={`Remove #${explore.activeTag} filter`}
            >
              <X size={12} />
            </button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-4">
          {show === "tracks" && (
            <div className="flex items-center gap-3 text-xs" aria-label="Sort tracks">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => dispatch(setExploreSort(opt.value))}
                  aria-pressed={explore.browseSort === opt.value}
                  className={`rounded-sm transition-colors ${
                    explore.browseSort === opt.value ? "text-heading" : "text-muted hover:text-heading"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {hasFilters && (
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-controls="explore-filters"
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors ${
                filtersOpen
                  ? "bg-surface-hover text-heading"
                  : "text-soft hover:bg-surface-hover hover:text-heading"
              }`}
            >
              <SlidersHorizontal size={14} />
              Filter
              {activeFilterCount > 0 && (
                <span className="readout text-[10px] text-primary">{activeFilterCount}</span>
              )}
            </button>
          )}
        </div>
      </header>

      {filtersOpen && hasFilters && (
        <section
          id="explore-filters"
          className="animate-fade-in mb-8 grid grid-cols-[4rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3 border-y border-border-light py-4"
        >
          {explore.genres.length > 0 && (
            <>
              <h2 className="label-caps">Genre</h2>
              <div className="-ml-2.5 flex flex-wrap gap-x-0.5 gap-y-1">
                {explore.genres.map((g) => {
                  const active = explore.activeGenre === g.genre;
                  return (
                    <button
                      key={g.genre}
                      onClick={() => dispatch(setActiveGenre(active ? null : g.genre))}
                      aria-pressed={active}
                      className={chip(active)}
                    >
                      {g.genre}
                      <span className="readout ml-1.5 text-[10px] opacity-55">{g.count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {explore.popularTags.length > 0 && (
            <>
              <h2 className="label-caps">Tag</h2>
              <div className="-ml-2.5 flex flex-wrap gap-x-0.5 gap-y-1">
                {explore.popularTags.map((t) => {
                  const active = explore.activeTag === t.tag;
                  return (
                    <button
                      key={t.tag}
                      onClick={() => dispatch(setActiveTag(active ? null : t.tag))}
                      aria-pressed={active}
                      className={chip(active)}
                    >
                      #{t.tag}
                      <span className="readout ml-1.5 text-[10px] opacity-55">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {explore.isLoading && count === 0 ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-heading" />
        </div>
      ) : count === 0 ? (
        <p className="py-16 text-center text-sm text-muted">
          {activeFilterCount > 0 ? `No ${noun} match these filters.` : `No ${noun} published yet.`}
        </p>
      ) : show === "all" ? (
        <div className={GRID}>
          {mixed.map((item) =>
            item.kind === "project" ? (
              <AlbumCard key={item.id} album={item.album} />
            ) : (
              <TrackCard
                key={item.id}
                track={item.track}
                queueTracks={mixedTrackIds}
                queueIndex={mixedTrackIds.indexOf(item.id)}
              />
            ),
          )}
        </div>
      ) : show === "projects" ? (
        <div className={GRID}>
          {browseAlbumList.map((album) => (
            <AlbumCard key={album.addressableId} album={album} />
          ))}
        </div>
      ) : (
        <div className={GRID}>
          {browseTracks.map((track, i) => (
            <TrackCard
              key={track.addressableId}
              track={track}
              queueTracks={browseTrackIds}
              queueIndex={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
