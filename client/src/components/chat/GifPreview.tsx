import { X } from "lucide-react";
import type { GifItem } from "@/types/emoji";

interface GifPreviewProps {
  gif: GifItem;
  onRemove: () => void;
}

export function GifPreview({ gif, onRemove }: GifPreviewProps) {
  return (
    <div className="px-3 pt-2 pb-1">
      <div className="group/gif relative inline-block rounded-lg border border-border-light bg-surface overflow-hidden">
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 z-10 rounded-full bg-black/60 p-1 text-white/80 hover:text-white transition-colors opacity-0 group-hover/gif:opacity-100"
        >
          <X size={12} />
        </button>
        <img
          src={gif.previewUrl}
          alt={gif.title}
          className="max-h-32 max-w-[200px] rounded-lg object-contain"
        />
      </div>
    </div>
  );
}
