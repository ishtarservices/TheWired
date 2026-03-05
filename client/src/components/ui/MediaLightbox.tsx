import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import { useState } from "react";

interface MediaLightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
}

/**
 * Fullscreen image lightbox overlay.
 * Click backdrop or press Escape to close. Scroll/pinch to zoom.
 */
export function MediaLightbox({ src, alt, onClose }: MediaLightboxProps) {
  const [zoom, setZoom] = useState(1);

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
    setZoom((z) => Math.min(5, Math.max(0.5, z - e.deltaY * 0.001)));
  }, []);

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
        <button
          onClick={onClose}
          className="rounded-full bg-white/10 p-2 text-white/80 hover:bg-white/20 transition-colors"
          title="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Image */}
      <div
        className="flex items-center justify-center overflow-auto max-h-[95vh] max-w-[95vw]"
        onWheel={handleWheel}
      >
        <img
          src={src}
          alt={alt ?? ""}
          className="select-none transition-transform duration-150"
          style={{ transform: `scale(${zoom})` }}
          draggable={false}
        />
      </div>
    </div>,
    document.body,
  );
}
