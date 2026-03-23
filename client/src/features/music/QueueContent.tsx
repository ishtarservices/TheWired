import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { X, GripVertical } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { removeFromQueue, reorderQueue, setCurrentTrack } from "@/store/slices/musicSlice";
import { getTrackImage } from "./trackImage";

export function QueueContent() {
  const dispatch = useAppDispatch();
  const queue = useAppSelector((s) => s.music.player.queue);
  const queueIndex = useAppSelector((s) => s.music.player.queueIndex);
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);

  // ── Drag-to-reorder state ──
  const [dragging, setDragging] = useState<{ fromIdx: number } | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const itemRects = useRef<DOMRect[]>([]);

  const captureRects = useCallback(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-queue-item]");
    itemRects.current = Array.from(items).map((el) =>
      el.getBoundingClientRect(),
    );
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

  if (queue.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-soft">Queue is empty</p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="py-1">
      {queue.map((trackId, idx) => {
        const track = tracks[trackId];
        if (!track) return null;
        const isCurrent = idx === queueIndex;
        const imageUrl = getTrackImage(track, albums);
        const isDragSource = dragging?.fromIdx === idx;
        const isDropTarget =
          dragging !== null &&
          dropIdx === idx &&
          dropIdx !== dragging.fromIdx;

        return (
          <div
            key={`${trackId}-${idx}`}
            data-queue-item
            onClick={() => {
              if (!dragging)
                dispatch(setCurrentTrack({ trackId, queueIndex: idx }));
            }}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-surface",
              isCurrent && "bg-pulse/8",
              isDragSource && "opacity-40",
              isDropTarget &&
                (dropIdx! < dragging!.fromIdx
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
              <p className="truncate text-[11px] text-soft">{track.artist}</p>
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
  );
}
