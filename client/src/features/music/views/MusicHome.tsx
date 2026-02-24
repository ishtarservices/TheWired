import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { TrackCard } from "../TrackCard";
import { AlbumCard } from "../AlbumCard";

export function MusicHome() {
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const trendingTrackIds = useAppSelector((s) => s.music.discovery.trendingTrackIds);
  const trendingAlbumIds = useAppSelector((s) => s.music.discovery.trendingAlbumIds);
  const newReleaseIds = useAppSelector((s) => s.music.discovery.newReleaseIds);

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

  // Also show recently ingested tracks as fallback (exclude unlisted from discovery)
  const recentTracks = useMemo(() => {
    return Object.values(tracks)
      .filter((t) => t.visibility === "public")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12);
  }, [tracks]);

  const recentAlbums = useMemo(() => {
    return Object.values(albums)
      .filter((a) => a.visibility === "public")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);
  }, [albums]);

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
            No music yet. Upload tracks or discover music from the network.
          </p>
        </div>
      </div>
    );
  }

  const trackAddrIds = displayTracks.map((t) => t.addressableId);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Trending / Recent Tracks */}
      {displayTracks.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-heading">
            {trendingTracks.length > 0 ? "Trending Tracks" : "Recent Tracks"}
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
            {newReleases.length > 0 ? "New Releases" : "Albums"}
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
