import { useState } from "react";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { VideoCard } from "./VideoCard";
import { VideoPlayer } from "./VideoPlayer";
import { parseVideoEvent, selectVideoSource } from "./imetaParser";
import type { NostrEvent } from "../../types/nostr";
import { X } from "lucide-react";

export function ReelsView() {
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const events = useAppSelector((s) => s.events);
  const [activeVideo, setActiveVideo] = useState<NostrEvent | null>(null);

  const reelIds = events.reels[activeSpaceId ?? "global"] ?? [];
  const reelEvents = reelIds
    .map((id) => eventsSelectors.selectById(events, id))
    .filter((e): e is NostrEvent => !!e)
    .sort((a, b) => b.created_at - a.created_at);

  if (activeVideo) {
    const video = parseVideoEvent(activeVideo);
    const sourceUrl = selectVideoSource(video.variants);

    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-black">
        <div className="relative w-full max-w-md">
          <button
            onClick={() => setActiveVideo(null)}
            className="absolute right-2 top-2 z-10 rounded-xl bg-black/50 p-1 text-white hover:bg-black/70 transition-colors"
          >
            <X size={20} />
          </button>
          {sourceUrl ? (
            <VideoPlayer
              src={sourceUrl}
              poster={video.thumbnail}
              className="aspect-[9/16] w-full rounded-lg bg-black"
            />
          ) : (
            <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg bg-panel">
              <p className="text-sm text-muted">No playable source</p>
            </div>
          )}
          {video.title && (
            <p className="mt-2 text-center text-sm text-white">
              {video.title}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {reelEvents.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted">No videos yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {reelEvents.map((event) => (
            <VideoCard
              key={event.id}
              video={parseVideoEvent(event)}
              onClick={() => setActiveVideo(event)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
