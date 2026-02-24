import { X, GripVertical } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { toggleQueuePanel, removeFromQueue } from "@/store/slices/musicSlice";
import { useAudioPlayer } from "./useAudioPlayer";
import { getTrackImage } from "./trackImage";

export function QueuePanel() {
  const dispatch = useAppDispatch();
  const queueVisible = useAppSelector((s) => s.music.queueVisible);
  const queue = useAppSelector((s) => s.music.player.queue);
  const queueIndex = useAppSelector((s) => s.music.player.queueIndex);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const { playQueue } = useAudioPlayer();

  if (!queueVisible) return null;

  return (
    <div className="flex w-72 flex-col border-l border-edge glass">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <h3 className="text-sm font-semibold text-heading">Now Playing</h3>
        <button
          onClick={() => dispatch(toggleQueuePanel())}
          className="rounded p-1 text-soft hover:text-heading"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {queue.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-soft">Queue is empty</p>
          </div>
        ) : (
          <div className="py-1">
            {queue.map((trackId, idx) => {
              const track = tracks[trackId];
              if (!track) return null;
              const isCurrent = idx === queueIndex;
              const imageUrl = getTrackImage(track, albums);

              return (
                <div
                  key={`${trackId}-${idx}`}
                  onClick={() => playQueue(queue, idx)}
                  className={`group flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors hover:bg-card-hover/30 ${
                    isCurrent ? "bg-card-hover/20" : ""
                  }`}
                >
                  <GripVertical size={12} className="shrink-0 text-muted" />
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded bg-card" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate text-xs font-medium ${
                        isCurrent ? "text-neon" : "text-heading"
                      }`}
                    >
                      {track.title}
                    </p>
                    <p className="truncate text-[11px] text-soft">
                      {track.artist}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch(removeFromQueue(idx));
                    }}
                    className="shrink-0 rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-heading"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
