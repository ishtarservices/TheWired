import { Play } from "lucide-react";
import type { VideoEvent } from "../../types/media";

interface VideoCardProps {
  video: VideoEvent;
  onClick?: () => void;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoCard({ video, onClick }: VideoCardProps) {
  return (
    <button
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg bg-card hover-lift transition-all duration-150"
    >
      <div className="aspect-[9/16] w-full bg-panel">
        {video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title ?? "Video"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Play size={32} className="text-faint" />
          </div>
        )}
      </div>

      {/* Neon-tinted overlay on hover */}
      <div className="absolute inset-0 flex items-center justify-center bg-pulse/30 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <div className="rounded-full bg-white/20 p-3 backdrop-blur-sm">
          <Play size={24} className="text-white" fill="white" />
        </div>
      </div>

      {video.duration && (
        <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
          {formatDuration(video.duration)}
        </div>
      )}

      {video.title && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8">
          <p className="truncate text-sm font-medium text-white">
            {video.title}
          </p>
        </div>
      )}
    </button>
  );
}
