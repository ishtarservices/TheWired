import { X, Music } from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { getTrackImage } from "../trackImage";
import { useAppSelector } from "@/store/hooks";

interface PanelHeaderProps {
  track: MusicTrack;
  onClose: () => void;
}

export function PanelHeader({ track, onClose }: PanelHeaderProps) {
  const albums = useAppSelector((s) => s.music.albums);
  const imageUrl = getTrackImage(track, albums);

  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
      {/* Thumbnail */}
      <div className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-surface">
        {imageUrl ? (
          <img src={imageUrl} alt={track.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music size={16} className="text-muted" />
          </div>
        )}
      </div>

      {/* Title + artist */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-heading">{track.title}</p>
        <p className="truncate text-xs text-soft">{track.artist}</p>
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="flex-none rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-heading"
      >
        <X size={16} />
      </button>
    </div>
  );
}
