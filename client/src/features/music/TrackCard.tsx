import { memo } from "react";
import { Play, Heart } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector } from "@/store/hooks";
import { useAudioPlayer } from "./useAudioPlayer";
import { useLibrary } from "./useLibrary";
import { FeaturedArtistsDisplay } from "./FeaturedArtistsDisplay";
import { getTrackImage } from "./trackImage";

interface TrackCardProps {
  track: MusicTrack;
  queueTracks?: string[];
  queueIndex?: number;
}

export const TrackCard = memo(function TrackCard({
  track,
  queueTracks,
  queueIndex,
}: TrackCardProps) {
  const { playQueue, play, player } = useAudioPlayer();
  const albums = useAppSelector((s) => s.music.albums);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { saveTrack, unsaveTrack, isTrackSaved } = useLibrary();
  const isPlaying = player.currentTrackId === track.addressableId && player.isPlaying;
  const imageUrl = getTrackImage(track, albums);
  const isOwner = pubkey === track.pubkey;
  const isLocal = track.visibility === "local";
  const saved = isTrackSaved(track.addressableId);

  const handleClick = () => {
    if (queueTracks && queueIndex !== undefined) {
      playQueue(queueTracks, queueIndex);
    } else {
      play(track.addressableId);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="group flex w-full flex-col overflow-hidden rounded-lg border border-edge bg-card/50 transition-colors hover:border-heading/30 hover:bg-card-hover/30"
    >
      <div className="relative aspect-square w-full">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={track.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-card">
            <Play size={32} className="text-muted" />
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <div className="scale-0 rounded-full bg-heading p-2.5 text-backdrop transition-transform group-hover:scale-100">
            {isPlaying ? (
              <div className="flex items-center gap-0.5">
                <span className="block h-3 w-0.5 animate-pulse bg-backdrop" />
                <span className="block h-3 w-0.5 animate-pulse bg-backdrop delay-75" />
                <span className="block h-3 w-0.5 animate-pulse bg-backdrop delay-150" />
              </div>
            ) : (
              <Play size={18} fill="currentColor" className="ml-0.5" />
            )}
          </div>
        </div>
        {track.visibility === "local" && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
            LOCAL
          </span>
        )}
        {!isOwner && !isLocal && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (saved) unsaveTrack(track.addressableId);
              else saveTrack(track.addressableId);
            }}
            className="absolute right-1.5 top-1.5 rounded-full bg-backdrop/70 p-1 text-soft opacity-0 transition-opacity hover:text-heading group-hover:opacity-100"
          >
            <Heart
              size={14}
              className={saved ? "fill-red-500 text-red-500" : ""}
            />
          </button>
        )}
      </div>
      <div className="p-2 text-left">
        <p className="truncate text-sm font-medium text-heading">{track.title}</p>
        <p className="truncate text-xs text-soft">
          {track.artist}
          <FeaturedArtistsDisplay pubkeys={track.featuredArtists} />
        </p>
      </div>
    </button>
  );
});
