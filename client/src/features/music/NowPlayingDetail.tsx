import { Music2 } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { getTrackImage } from "./trackImage";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { useResolvedArtist } from "./useResolvedArtist";

export function NowPlayingDetail() {
  const currentTrackId = useAppSelector(
    (s) => s.music.player.currentTrackId,
  );
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);

  const track = currentTrackId ? tracks[currentTrackId] : null;
  const album = track?.albumRef ? albums[track.albumRef] : null;
  const imageUrl = track ? getTrackImage(track, albums) : null;
  const artistName = useResolvedArtist(
    track?.artist ?? "",
    track?.artistPubkeys,
  );

  if (!track) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-soft">No track playing</p>
      </div>
    );
  }

  const minutes = track.duration
    ? Math.floor(track.duration / 60)
    : null;
  const seconds = track.duration ? track.duration % 60 : null;

  return (
    <div className="space-y-4 p-4">
      {/* Album art */}
      <div className="aspect-square w-full overflow-hidden rounded-xl">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={track.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-card">
            <Music2 size={32} className="text-muted" />
          </div>
        )}
      </div>

      {/* Track info */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-heading truncate">
          {track.title}
        </h3>
        <p className="text-xs text-soft truncate">{artistName}</p>
        {album && (
          <p className="text-[11px] text-muted truncate">{album.title}</p>
        )}
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-2">
        {track.duration != null && minutes != null && seconds != null && (
          <span className="rounded-md bg-surface px-2 py-0.5 text-[10px] text-soft">
            {minutes}:{String(seconds).padStart(2, "0")}
          </span>
        )}
        {track.genre && (
          <span className="rounded-md bg-surface px-2 py-0.5 text-[10px] text-soft">
            {track.genre}
          </span>
        )}
        {track.hashtags.slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-surface px-2 py-0.5 text-[10px] text-soft"
          >
            #{tag}
          </span>
        ))}
      </div>

      {/* Annotations (compact) */}
      <AnnotationsPanel
        targetRef={track.addressableId}
        targetName={track.title}
        ownerPubkey={track.pubkey}
        compact
      />
    </div>
  );
}
