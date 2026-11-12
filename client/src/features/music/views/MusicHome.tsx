import { useMemo, useEffect } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import {
  addTracks,
  addAlbums,
  setTrendingTrackIds,
  setTrendingAlbumIds,
  setExploreGenres,
  setActiveGenre,
  setActiveTag,
  setMusicView,
} from "@/store/slices/musicSlice";
import { selectLibraryTracks, selectLibraryAlbums } from "../musicSelectors";
import { getGenres, browseMusic, browseAlbums as browseAlbumsApi } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { TrackCard } from "../TrackCard";
import { AlbumCard } from "../AlbumCard";
import { MusicGetStarted } from "../MusicGetStarted";

export function MusicHome() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const dispatch = useAppDispatch();
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const trendingTrackIds = useAppSelector((s) => s.music.discovery.trendingTrackIds);
  const trendingAlbumIds = useAppSelector((s) => s.music.discovery.trendingAlbumIds);
  const newReleaseIds = useAppSelector((s) => s.music.discovery.newReleaseIds);
  const exploreGenres = useAppSelector((s) => s.music.explore.genres);

  const libraryTracksSelector = useMemo(() => selectLibraryTracks(pubkey), [pubkey]);
  const libraryAlbumsSelector = useMemo(() => selectLibraryAlbums(pubkey), [pubkey]);
  const libraryTracks = useAppSelector(libraryTracksSelector);
  const libraryAlbums = useAppSelector(libraryAlbumsSelector);

  // Load genres, tags, and trending data once
  useEffect(() => {
    if (exploreGenres.length === 0) {
      getGenres()
        .then((res) => dispatch(setExploreGenres(res.data)))
        .catch((err) => console.debug("[music] Failed to load genres:", err));
    }

    // Fetch trending tracks
    if (trendingTrackIds.length === 0) {
      browseMusic({ sort: "trending", limit: 12 })
        .then((res) => {
          const parsed = res.data.tracks.map((evt: any) => parseTrackEvent(evt));
          dispatch(addTracks(parsed));
          dispatch(setTrendingTrackIds(parsed.map((t) => t.addressableId)));
          for (const evt of res.data.tracks) {
            processIncomingEvent(evt, "browse").catch(() => {});
          }
        })
        .catch((err) => console.debug("[music] Failed to load trending tracks:", err));
    }

    // Fetch trending albums
    if (trendingAlbumIds.length === 0) {
      browseAlbumsApi({ sort: "trending", limit: 8 })
        .then((res) => {
          const parsed = res.data.albums.map((evt: any) => parseAlbumEvent(evt));
          dispatch(addAlbums(parsed));
          dispatch(setTrendingAlbumIds(parsed.map((a) => a.addressableId)));
          for (const evt of res.data.albums) {
            processIncomingEvent(evt, "browse").catch(() => {});
          }
        })
        .catch((err) => console.debug("[music] Failed to load trending albums:", err));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const trendingTracks = useMemo(
    () => trendingTrackIds.map((id) => tracks[id]).filter(Boolean),
    [trendingTrackIds, tracks],
  );

  const trendingAlbums = useMemo(
    () => trendingAlbumIds.map((id) => albums[id]).filter(Boolean),
    [trendingAlbumIds, albums],
  );

  const newReleases = useMemo(
    () => newReleaseIds.map((id) => albums[id]).filter(Boolean),
    [newReleaseIds, albums],
  );

  // Library tracks (saved + own) for the fallback section
  const recentTracks = libraryTracks.slice(0, 12);
  const recentAlbums = libraryAlbums.slice(0, 8);

  const displayTracks = trendingTracks.length > 0 ? trendingTracks : recentTracks;
  const displayAlbums = newReleases.length > 0 ? newReleases : recentAlbums;
  const hasContent =
    displayTracks.length > 0 || displayAlbums.length > 0 || trendingAlbums.length > 0;

  // Nothing of the viewer's own (uploaded or saved): the home either IS the
  // invitation, or carries it as a strip above the trending content.
  const libraryEmpty = libraryTracks.length === 0 && libraryAlbums.length === 0;

  if (!hasContent) {
    return <MusicGetStarted />;
  }

  const trackAddrIds = displayTracks.map((t) => t.addressableId);

  const handleGenreClick = (genre: string) => {
    dispatch(setActiveGenre(genre));
    dispatch(setActiveTag(null));
    dispatch(setMusicView("explore"));
  };


  return (
    <div className={`flex-1 overflow-y-auto px-8 py-7 ${scrollPaddingClass}`}>
      {libraryEmpty && <MusicGetStarted variant="banner" />}

      {/* Trending / Library Tracks */}
      {displayTracks.length > 0 && (
        <section className="mb-9">
          <h2 className="mb-3.5 text-[15px] font-semibold tracking-[-0.01em] text-heading">
            {trendingTracks.length > 0 ? "Trending tracks" : "Your Library"}
          </h2>
          <div className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-3 pt-1">
            {displayTracks.map((track, i) => (
              <div key={track.addressableId} className="w-44 shrink-0">
                <TrackCard
                  track={track}
                  queueTracks={trackAddrIds}
                  queueIndex={i}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Albums */}
      {displayAlbums.length > 0 && (
        <section className="mb-9">
          <h2 className="mb-3.5 text-[15px] font-semibold tracking-[-0.01em] text-heading">
            {newReleases.length > 0 ? "New releases" : "Projects"}
          </h2>
          <div className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-3 pt-1">
            {displayAlbums.map((album) => (
              <div key={album.addressableId} className="w-44 shrink-0">
                <AlbumCard album={album} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trending Albums */}
      {trendingAlbums.length > 0 && (
        <section className="mb-9">
          <h2 className="mb-3.5 text-[15px] font-semibold tracking-[-0.01em] text-heading">
            Trending projects
          </h2>
          <div className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-3 pt-1">
            {trendingAlbums.map((album) => (
              <div key={album.addressableId} className="w-44 shrink-0">
                <AlbumCard album={album} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Genres are a way in to Explore, not content: one quiet line at the
          end of the page. */}
      {exploreGenres.length > 0 && (
        <section className="border-t border-border-light pt-5">
          <h2 className="label-caps mb-3">Browse by genre</h2>
          <div className="-ml-2.5 flex flex-wrap gap-x-0.5 gap-y-1">
            {exploreGenres.slice(0, 14).map((g) => (
              <button
                key={g.genre}
                onClick={() => handleGenreClick(g.genre)}
                className="rounded-full px-2.5 py-1 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
              >
                {g.genre}
                <span className="readout ml-1.5 text-[10px] opacity-55">{g.count}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
