import { Music2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { getTrackImage } from "./trackImage";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { useResolvedArtist, resolveArtistDetailTarget } from "./useResolvedArtist";

export function NowPlayingDetail() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
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
  const artistTarget = track
    ? resolveArtistDetailTarget(track.artist, track.artistPubkeys)
    : null;
  const albumTarget = album?.addressableId ?? null;

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
        {artistTarget ? (
          <button
            type="button"
            onClick={() => {
              dispatch(setSidebarMode("music"));
              dispatch(setActiveDetailId(artistTarget));
              navigate("/");
            }}
            className="block max-w-full truncate text-xs text-soft hover:text-heading hover:underline"
          >
            {artistName}
          </button>
        ) : (
          <p className="text-xs text-soft truncate">{artistName}</p>
        )}
        {album && albumTarget && (
          <button
            type="button"
            onClick={() => {
              dispatch(setSidebarMode("music"));
              dispatch(
                setActiveDetailId({ view: "album-detail", id: albumTarget }),
              );
              navigate("/");
            }}
            className="block max-w-full truncate text-[11px] text-muted hover:text-heading hover:underline"
          >
            {album.title}
          </button>
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
