import { useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, Download, RotateCcw } from "lucide-react";
import { useState } from "react";

interface MediaLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/** Download a media URL by fetching as blob and triggering a save dialog. */
export function downloadMedia(url: string, filename?: string) {
  const name = filename || url.split("/").pop()?.split("?")[0] || "download";
  fetch(url)
    .then((res) => res.blob())
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
    })
    .catch(() => {
      // Fallback: open in new tab if fetch fails (CORS)
      window.open(url, "_blank");
    });
}

/**
 * Fullscreen image lightbox overlay.
 * Click backdrop or press Escape to close. Scroll/pinch to zoom.
 * Images are fit-to-screen by default; zoom scales from there.
 */
export function MediaLightbox({ src, alt, onClose }: MediaLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    // Prevent body scroll while lightbox is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setZoom((z) => Math.min(5, Math.max(0.5, z - e.deltaY * 0.003)));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (zoom <= 1) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [zoom, translate],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      setTranslate({
        x: dragStart.current.tx + (e.clientX - dragStart.current.x),
        y: dragStart.current.ty + (e.clientY - dragStart.current.y),
      });
    },
    [dragging],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Reset pan when zoom returns to 1
  useEffect(() => {
    if (zoom <= 1) setTranslate({ x: 0, y: 0 });
  }, [zoom]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in-up"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Controls */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <button
          onClick={() => downloadMedia(src)}
          className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 transition-colors"
          title="Download"
        >
          <Download size={18} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(5, z + 0.5))}
          className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 transition-colors"
          title="Zoom in"
        >
          <ZoomIn size={18} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.5))}
          className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 transition-colors"
          title="Zoom out"
        >
          <ZoomOut size={18} />
        </button>
        {zoom !== 1 && (
          <button
            onClick={resetView}
            className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 transition-colors"
            title="Reset zoom"
          >
            <RotateCcw size={18} />
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 transition-colors"
          title="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Zoom indicator */}
      {zoom !== 1 && (
        <div className="absolute left-4 top-4 z-10 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/70">
          {Math.round(zoom * 100)}%
        </div>
      )}

      {/* Image */}
      <div
        className="flex items-center justify-center max-h-[95vh] max-w-[95vw] overflow-hidden"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default" }}
      >
        <img
          src={src}
          alt={alt ?? ""}
          className="max-h-[90vh] max-w-[90vw] object-contain select-none transition-transform duration-150"
          style={{
            transform: `scale(${zoom}) translate(${translate.x / zoom}px, ${translate.y / zoom}px)`,
          }}
          draggable={false}
        />
      </div>
    </div>,
    document.body,
  );
}
