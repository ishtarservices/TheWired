import { useMemo } from "react";
import { Play, Pause, Disc3 } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { getTrackImage } from "@/features/music/trackImage";

interface MusicEmbedCardProps {
  kind: number;
  pubkey: string;
  identifier: string;
}

export function MusicEmbedCard({ kind, pubkey, identifier }: MusicEmbedCardProps) {
  const dispatch = useAppDispatch();
  const addressableId = `${kind}:${pubkey}:${identifier}`;
  const isTrack = kind === 31683;

  const track = useAppSelector((s) =>
    isTrack ? s.music.tracks[addressableId] : undefined,
  );
  const album = useAppSelector((s) =>
    !isTrack ? s.music.albums[addressableId] : undefined,
  );
  const albums = useAppSelector((s) => s.music.albums);
  const { play, togglePlay, player } = useAudioPlayer();

  const isCurrent = isTrack && player.currentTrackId === addressableId;
  const isPlaying = isCurrent && player.isPlaying;

  const image = useMemo(() => {
    if (isTrack && track) return getTrackImage(track, albums);
    if (!isTrack && album) return album.imageUrl;
    return undefined;
  }, [isTrack, track, album, albums]);

  const title = isTrack ? track?.title : album?.title;
  const artist = isTrack ? track?.artist : album?.artist;

  // Not yet in store -- render a minimal placeholder
  if (!title) {
    return (
      <span className="font-mono text-xs text-neon/70 bg-surface px-1 py-0.5 rounded">
        {identifier || "music"}
      </span>
    );
  }

  const handleClick = () => {
    if (isTrack && track) {
      if (isCurrent) {
        togglePlay();
      } else {
        play(track.addressableId);
      }
    } else if (!isTrack) {
      dispatch(setSidebarMode("music"));
      dispatch(setActiveDetailId({ view: "album-detail", id: addressableId }));
    }
  };

  const PlayPauseIcon = isPlaying ? Pause : Play;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleClick();
      }}
      className={`mt-1 inline-flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all hover-lift max-w-xs ${
        isCurrent
          ? "border-pulse/40 card-glass"
          : "border-edge card-glass hover:border-edge-light"
      }`}
    >
      {image ? (
        <img
          src={image}
          alt={title}
          className="h-10 w-10 rounded-lg object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card">
          <Disc3 size={18} className="text-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${isCurrent ? "text-neon" : "text-heading"}`}>
          {title}
        </p>
        <p className="truncate text-xs text-soft">{artist}</p>
      </div>
      {isTrack && (
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
          isPlaying
            ? "bg-white/10 border border-pulse/40"
            : "bg-gradient-to-r from-pulse to-pulse-soft"
        }`}>
          <PlayPauseIcon
            size={12}
            fill={isPlaying ? "currentColor" : "white"}
            className={isPlaying ? "text-pulse" : "ml-0.5 text-white"}
          />
        </div>
      )}
    </button>
  );
}
