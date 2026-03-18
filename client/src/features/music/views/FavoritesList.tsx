import { useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { selectFavoritedTracks, selectFavoritedAlbums } from "../musicSelectors";
import { TrackRow } from "../TrackRow";
import { AlbumCard } from "../AlbumCard";

export function FavoritesList() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const favTracks = useAppSelector(selectFavoritedTracks);
  const favAlbums = useAppSelector(selectFavoritedAlbums);

  const queueIds = favTracks.map((t) => t.addressableId);

  if (favTracks.length === 0 && favAlbums.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">
          No favorites yet. Use the heart icon to mark songs and projects you love.
        </p>
      </div>
    );
  }

  return (
    <div className={`flex-1 overflow-y-auto p-4 ${scrollPaddingClass}`}>
      <h2 className="mb-3 text-lg font-semibold text-heading">Favorites</h2>

      {/* Favorited Albums */}
      {favAlbums.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted">
            Projects
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {favAlbums.map((album) => (
              <AlbumCard key={album.addressableId} album={album} />
            ))}
          </div>
        </section>
      )}

      {/* Favorited Tracks */}
      {favTracks.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.15em] text-muted">
            Songs
          </h3>
          <div className="grid grid-cols-[2rem_1fr_1fr_4rem_2rem] gap-4 border-b border-edge px-3 pb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
            <span>#</span>
            <span>Title</span>
            <span>Genre</span>
            <span className="text-right">Time</span>
            <span />
          </div>
          <div className="mt-1">
            {favTracks.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={i}
                queueTracks={queueIds}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
