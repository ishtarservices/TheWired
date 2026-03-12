import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { X, GripVertical } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { toggleQueuePanel, removeFromQueue, reorderQueue } from "@/store/slices/musicSlice";
import { setCurrentTrack } from "@/store/slices/musicSlice";
import { getTrackImage } from "./trackImage";
import { useResizeHandle } from "@/components/layout/useResizeHandle";

export function QueuePanel() {
  const dispatch = useAppDispatch();
  const queueVisible = useAppSelector((s) => s.music.queueVisible);
  const queue = useAppSelector((s) => s.music.player.queue);
  const queueIndex = useAppSelector((s) => s.music.player.queueIndex);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);

  // ── Drag-to-reorder state (mouse-event based, mirrors useResizeHandle) ──
  const [dragging, setDragging] = useState<{ fromIdx: number } | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRects = useRef<DOMRect[]>([]);

  const captureRects = useCallback(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-queue-item]");
    itemRects.current = Array.from(items).map((el) => el.getBoundingClientRect());
  }, []);

  const getDropIndex = useCallback((clientY: number): number => {
    const rects = itemRects.current;
    for (let i = 0; i < rects.length; i++) {
      const mid = rects[i].top + rects[i].height / 2;
      if (clientY < mid) return i;
    }
    return rects.length - 1;
  }, []);

  const handleGripMouseDown = useCallback(
    (e: React.MouseEvent, idx: number) => {
      e.preventDefault();
      e.stopPropagation();
      captureRects();
      setDragging({ fromIdx: idx });
      setDropIdx(idx);
    },
    [captureRects],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const target = getDropIndex(e.clientY);
      setDropIdx(target);

      // Auto-scroll when near edges
      const container = listRef.current?.parentElement;
      if (container) {
        const rect = container.getBoundingClientRect();
        const edgeZone = 40;
        if (e.clientY < rect.top + edgeZone) {
          container.scrollTop -= 8;
        } else if (e.clientY > rect.bottom - edgeZone) {
          container.scrollTop += 8;
        }
      }
    };

    const onMouseUp = () => {
      if (dragging && dropIdx !== null && dragging.fromIdx !== dropIdx) {
        dispatch(reorderQueue({ from: dragging.fromIdx, to: dropIdx }));
      }
      setDragging(null);
      setDropIdx(null);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, dropIdx, dispatch, getDropIndex]);

  const { width, isDragging: isResizing, onMouseDown, onDoubleClick } = useResizeHandle({
    defaultWidth: 288,
    side: "left",
  });

  if (!queueVisible) return null;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col glass relative",
        !isResizing && "transition-[width] duration-200",
      )}
      style={{ width }}
    >
      {/* Resize handle — left edge */}
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={onDoubleClick}
        className="group absolute left-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize"
      >
        <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-neon/10 via-edge to-pulse/20" />
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-0 transition-all duration-150",
            isResizing
              ? "w-[2px] bg-pulse/40"
              : "group-hover:w-[2px] group-hover:bg-pulse/20",
          )}
        />
      </div>

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
          <div ref={listRef} className="py-1">
            {queue.map((trackId, idx) => {
              const track = tracks[trackId];
              if (!track) return null;
              const isCurrent = idx === queueIndex;
              const imageUrl = getTrackImage(track, albums);
              const isDragSource = dragging?.fromIdx === idx;
              const isDropTarget = dragging !== null && dropIdx === idx && dropIdx !== dragging.fromIdx;

              return (
                <div
                  key={`${trackId}-${idx}`}
                  data-queue-item
                  onClick={() => {
                    if (!dragging) dispatch(setCurrentTrack({ trackId, queueIndex: idx }));
                  }}
                  className={cn(
                    "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-surface",
                    isCurrent && "bg-pulse/8",
                    isDragSource && "opacity-40",
                    isDropTarget && (dropIdx! < dragging!.fromIdx
                      ? "border-t-2 border-pulse/60"
                      : "border-b-2 border-pulse/60"),
                  )}
                >
                  <GripVertical
                    size={12}
                    className="shrink-0 cursor-grab text-muted active:cursor-grabbing"
                    onMouseDown={(e) => handleGripMouseDown(e, idx)}
                  />
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
