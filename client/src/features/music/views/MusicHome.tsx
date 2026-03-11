import { useMemo, useEffect } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  setExploreGenres,
  setExplorePopularTags,
  setActiveGenre,
  setActiveTag,
  setMusicView,
} from "@/store/slices/musicSlice";
import { selectLibraryTracks, selectLibraryAlbums } from "../musicSelectors";
import { getGenres, getPopularTags } from "@/lib/api/music";
import { TrackCard } from "../TrackCard";
import { AlbumCard } from "../AlbumCard";
import { GenreCard } from "../GenreCard";

export function MusicHome() {
  const dispatch = useAppDispatch();
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const trendingTrackIds = useAppSelector((s) => s.music.discovery.trendingTrackIds);
  const trendingAlbumIds = useAppSelector((s) => s.music.discovery.trendingAlbumIds);
  const newReleaseIds = useAppSelector((s) => s.music.discovery.newReleaseIds);
  const exploreGenres = useAppSelector((s) => s.music.explore.genres);
  const popularTags = useAppSelector((s) => s.music.explore.popularTags);

  const libraryTracksSelector = useMemo(() => selectLibraryTracks(pubkey), [pubkey]);
  const libraryAlbumsSelector = useMemo(() => selectLibraryAlbums(pubkey), [pubkey]);
  const libraryTracks = useAppSelector(libraryTracksSelector);
  const libraryAlbums = useAppSelector(libraryAlbumsSelector);

  // Load genres and tags once
  useEffect(() => {
    if (exploreGenres.length === 0) {
      getGenres()
        .then((res) => dispatch(setExploreGenres(res.data)))
        .catch((err) => console.debug("[music] Failed to load genres:", err));
    }
    if (popularTags.length === 0) {
      getPopularTags()
        .then((res) => dispatch(setExplorePopularTags(res.data)))
        .catch((err) => console.debug("[music] Failed to load tags:", err));
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

  if (!hasContent) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-heading">Music</h2>
          <p className="mt-1 text-sm text-soft">
            Upload tracks or save music to build your library.
          </p>
        </div>
      </div>
    );
  }

  const trackAddrIds = displayTracks.map((t) => t.addressableId);

  const handleGenreClick = (genre: string) => {
    dispatch(setActiveGenre(genre));
    dispatch(setActiveTag(null));
    dispatch(setMusicView("explore"));
  };

  const handleTagClick = (tag: string) => {
    dispatch(setActiveTag(tag));
    dispatch(setActiveGenre(null));
    dispatch(setMusicView("explore"));
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Browse by Genre */}
      {exploreGenres.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-heading">Browse by Genre</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {exploreGenres.slice(0, 10).map((g) => (
              <GenreCard
                key={g.genre}
                genre={g.genre}
                count={g.count}
                onClick={() => handleGenreClick(g.genre)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Popular Tags */}
      {popularTags.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-heading">Popular Tags</h2>
          <div className="flex flex-wrap gap-1.5">
            {popularTags.slice(0, 15).map((t) => (
              <button
                key={t.tag}
                onClick={() => handleTagClick(t.tag)}
                className="rounded-full bg-card px-2.5 py-1 text-xs text-soft transition-colors hover:bg-card-hover hover:text-heading"
              >
                #{t.tag}
                <span className="ml-1 text-muted">{t.count}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Trending / Library Tracks */}
      {displayTracks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-heading">
            {trendingTracks.length > 0 ? "Trending Tracks" : "Your Library"}
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {displayTracks.map((track, i) => (
              <div key={track.addressableId} className="w-40 shrink-0">
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
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-heading">
            {newReleases.length > 0 ? "New Releases" : "Projects"}
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {displayAlbums.map((album) => (
              <div key={album.addressableId} className="w-40 shrink-0">
                <AlbumCard album={album} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Trending Albums */}
      {trendingAlbums.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-heading">
            Trending Albums
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {trendingAlbums.map((album) => (
              <div key={album.addressableId} className="w-40 shrink-0">
                <AlbumCard album={album} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
