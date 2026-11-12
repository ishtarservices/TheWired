import { useMemo } from "react";
import { ArrowLeft, Play, Shuffle, Heart, Plus, Check } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { TrackRow } from "./TrackRow";
import { Artwork } from "./Artwork";
import { useAudioPlayer } from "./useAudioPlayer";
import { useLibrary } from "./useLibrary";
import { useResolvedArtist } from "./useResolvedArtist";

interface SpaceAlbumDetailProps {
  albumId: string;
  onBack: () => void;
}

export function SpaceAlbumDetail({ albumId, onBack }: SpaceAlbumDetailProps) {
  const album = useAppSelector((s) => s.music.albums[albumId]);
  const tracks = useAppSelector((s) => s.music.tracks);
  const tracksByAlbum = useAppSelector((s) => s.music.tracksByAlbum[albumId]);
  const { playQueue } = useAudioPlayer();
  const { saveAlbum, unsaveAlbum, isAlbumSaved, favoriteAlbum, unfavoriteAlbum, isAlbumFavorited } = useLibrary();
  const resolvedArtist = useResolvedArtist(album?.artist ?? "", album?.artistPubkeys);

  const albumTracks = useMemo(() => {
    const refs = album?.trackRefs ?? tracksByAlbum ?? [];
    return refs.map((id) => tracks[id]).filter(Boolean);
  }, [album?.trackRefs, tracksByAlbum, tracks]);

  if (!album) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Album not found</p>
      </div>
    );
  }

  const queueIds = albumTracks.map((t) => t.addressableId);
  const saved = isAlbumSaved(albumId);
  const favorited = isAlbumFavorited(albumId);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="flex items-end gap-6 px-6 pb-6 pt-5">
        <button
          onClick={onBack}
          className="-ml-2 self-start rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <ArrowLeft size={16} />
        </button>
        <Artwork
          src={album.imageUrl}
          title={album.title}
          className="h-36 w-36 rounded-xl shadow-[var(--shadow-lg)]"
        />
        <div>
          <p className="label-caps text-soft">
            {album.projectType === "album" ? "Album" : album.projectType}
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-heading">{album.title}</h2>
          <p className="text-sm text-soft">
            {resolvedArtist} &middot; {album.trackCount} track
            {album.trackCount !== 1 ? "s" : ""}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              onClick={() => playQueue(queueIds, 0)}
              disabled={queueIds.length === 0}
              className="flex h-9 items-center gap-2 rounded-full bg-heading pl-3.5 pr-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 press-effect disabled:opacity-40"
            >
              <Play size={14} fill="currentColor" />
              Play All
            </button>
            <button
              onClick={() => {
                const shuffled = [...queueIds].sort(() => Math.random() - 0.5);
                playQueue(shuffled, 0);
              }}
              disabled={queueIds.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading disabled:opacity-50"
            >
              <Shuffle size={14} />
              Shuffle
            </button>
            <button
              onClick={() => {
                if (saved) unsaveAlbum(albumId);
                else saveAlbum(albumId);
              }}
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading"
            >
              {saved ? (
                <Check size={14} className="text-green-400" />
              ) : (
                <Plus size={14} />
              )}
              {saved ? "In Library" : "Save"}
            </button>
            <button
              onClick={() => {
                if (favorited) unfavoriteAlbum(albumId);
                else favoriteAlbum(albumId);
              }}
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading"
            >
              <Heart
                size={14}
                className={favorited ? "fill-red-500 text-red-500" : ""}
              />
              {favorited ? "Favorited" : "Favorite"}
            </button>
          </div>
        </div>
      </div>

      {/* Track list */}
      <div className="px-5 py-3">
        {albumTracks.length > 0 ? (
          albumTracks.map((track, i) => (
            <TrackRow
              key={track.addressableId}
              track={track}
              index={i}
              queueTracks={queueIds}
              context="album"
            />
          ))
        ) : (
          <p className="text-sm text-soft">No tracks in this album yet</p>
        )}
      </div>
    </div>
  );
}
