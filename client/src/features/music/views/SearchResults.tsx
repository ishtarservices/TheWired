import { useEffect, useCallback, useRef } from "react";
import { Search, User } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useProfile } from "@/features/profile/useProfile";
import {
  addTracks,
  addAlbums,
  setSearchResults,
  setSearchLoading,
  setSearchQuery,
  setActiveDetailId,
} from "@/store/slices/musicSlice";
import { api } from "@/lib/api/client";
import { putEvent } from "@/lib/db/eventStore";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { TrackCard } from "../TrackCard";
import { AlbumCard } from "../AlbumCard";
import { resolveMusic } from "@/lib/api/music";
import type { MusicSearchHit } from "../useMusicSearch";

export function SearchResults() {
  const dispatch = useAppDispatch();
  const search = useAppSelector((s) => s.music.search);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        dispatch(setSearchResults({ trackIds: [], albumIds: [] }));
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      dispatch(setSearchLoading(true));
      try {
        const [trackRes, albumRes] = await Promise.all([
          api<MusicSearchHit[]>(
            `/search/music?q=${encodeURIComponent(q)}&type=track&limit=24`,
            { signal: controller.signal, auth: false },
          ),
          api<MusicSearchHit[]>(
            `/search/music?q=${encodeURIComponent(q)}&type=album&limit=12`,
            { signal: controller.signal, auth: false },
          ),
        ]);

        if (controller.signal.aborted) return;

        // Resolve full events for tracks not already in store
        const trackHits = trackRes.data;
        const albumHits = albumRes.data;

        // Batch-resolve tracks we don't have yet
        const missingTrackIds = trackHits.filter(
          (h) => !tracks[h.addressable_id],
        );
        if (missingTrackIds.length > 0) {
          const resolved = await Promise.allSettled(
            missingTrackIds.map(async (h) => {
              const [, pubkey, ...slugParts] = h.addressable_id.split(":");
              const slug = slugParts.join(":");
              const res = await resolveMusic("track", pubkey, slug);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const rawEvent = (res.data as any).event;
              // Persist to IndexedDB so it survives app restart
              putEvent(rawEvent).catch(() => {});
              return parseTrackEvent(rawEvent);
            }),
          );
          const parsed = resolved
            .filter((r): r is PromiseFulfilledResult<ReturnType<typeof parseTrackEvent>> => r.status === "fulfilled")
            .map((r) => r.value);
          if (parsed.length > 0) dispatch(addTracks(parsed));
        }

        // Batch-resolve albums we don't have yet
        const missingAlbumIds = albumHits.filter(
          (h) => !albums[h.addressable_id],
        );
        if (missingAlbumIds.length > 0) {
          const resolved = await Promise.allSettled(
            missingAlbumIds.map(async (h) => {
              const [, pubkey, ...slugParts] = h.addressable_id.split(":");
              const slug = slugParts.join(":");
              const res = await resolveMusic("album", pubkey, slug);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const rawEvent = (res.data as any).event;
              // Persist to IndexedDB so it survives app restart
              putEvent(rawEvent).catch(() => {});
              return parseAlbumEvent(rawEvent);
            }),
          );
          const parsed = resolved
            .filter((r): r is PromiseFulfilledResult<ReturnType<typeof parseAlbumEvent>> => r.status === "fulfilled")
            .map((r) => r.value);
          if (parsed.length > 0) dispatch(addAlbums(parsed));
        }

        dispatch(
          setSearchResults({
            trackIds: trackHits.map((h) => h.addressable_id),
            albumIds: albumHits.map((h) => h.addressable_id),
          }),
        );
      } catch {
        // abort or network error
      } finally {
        if (!controller.signal.aborted) dispatch(setSearchLoading(false));
      }
    },
    [dispatch, tracks, albums],
  );

  // Run search when query changes
  useEffect(() => {
    const timer = setTimeout(() => doSearch(search.query), 300);
    return () => clearTimeout(timer);
  }, [search.query, doSearch]);

  const resultTracks = search.trackResults
    .map((id) => tracks[id])
    .filter(Boolean);
  const resultAlbums = search.albumResults
    .map((id) => albums[id])
    .filter(Boolean);
  const trackQueueIds = resultTracks.map((t) => t.addressableId);
  const hasResults = resultTracks.length > 0 || resultAlbums.length > 0;

  // Collect unique artists from results for an "Artists" section
  const artistMap = new Map<string, { pubkey: string; trackCount: number }>();
  for (const t of resultTracks) {
    const existing = artistMap.get(t.pubkey);
    artistMap.set(t.pubkey, {
      pubkey: t.pubkey,
      trackCount: (existing?.trackCount ?? 0) + 1,
    });
  }
  const uniqueArtists = [...artistMap.values()];

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Search header with inline input */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Search size={20} className="text-muted" />
          <input
            type="text"
            value={search.query}
            onChange={(e) => dispatch(setSearchQuery(e.target.value))}
            placeholder="Search tracks, albums, artists..."
            autoFocus
            className="flex-1 bg-transparent text-xl font-semibold text-heading placeholder-muted outline-none"
          />
        </div>
        {search.query && (
          <p className="mt-2 text-sm text-soft">
            {search.isLoading
              ? "Searching..."
              : hasResults
                ? `Showing results for "${search.query}"`
                : `No results for "${search.query}"`}
          </p>
        )}
      </div>

      {!search.query && (
        <div className="flex flex-col items-center justify-center py-20">
          <Search size={48} className="mb-4 text-muted/30" />
          <p className="text-sm text-soft">
            Search for tracks, albums, or artists
          </p>
        </div>
      )}

      {search.isLoading && search.query && (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
        </div>
      )}

      {!search.isLoading && hasResults && (
        <>
          {/* Artists section */}
          {uniqueArtists.length > 0 && (
            <section className="mb-8">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                Artists
              </h3>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {uniqueArtists.slice(0, 6).map((a) => (
                  <ArtistChip
                    key={a.pubkey}
                    pubkey={a.pubkey}
                    trackCount={a.trackCount}
                    onClick={() =>
                      dispatch(
                        setActiveDetailId({
                          view: "artist-detail",
                          id: a.pubkey,
                        }),
                      )
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* Albums section */}
          {resultAlbums.length > 0 && (
            <section className="mb-8">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                Albums
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {resultAlbums.map((album) => (
                  <AlbumCard key={album.addressableId} album={album} />
                ))}
              </div>
            </section>
          )}

          {/* Tracks section */}
          {resultTracks.length > 0 && (
            <section className="mb-8">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                Tracks
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {resultTracks.map((track, i) => (
                  <TrackCard
                    key={track.addressableId}
                    track={track}
                    queueTracks={trackQueueIds}
                    queueIndex={i}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Small artist chip for the search results */
function ArtistChip({
  pubkey,
  trackCount,
  onClick,
}: {
  pubkey: string;
  trackCount: number;
  onClick: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-2.5 rounded-xl border border-edge card-glass px-3 py-2 transition-all hover:border-edge-light hover-lift"
    >
      {profile?.picture ? (
        <img
          src={profile.picture}
          alt={name}
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-card">
          <User size={14} className="text-muted" />
        </div>
      )}
      <div className="text-left">
        <p className="text-sm font-medium text-heading">{name}</p>
        <p className="text-xs text-muted">
          {trackCount} track{trackCount !== 1 ? "s" : ""}
        </p>
      </div>
    </button>
  );
}
