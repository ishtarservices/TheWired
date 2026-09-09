import { memo } from "react";
import { Disc3 } from "lucide-react";

export const AlbumTile = memo(function AlbumTile({
  title,
  artist,
  imageUrl,
  onOpen,
}: {
  title: string;
  artist: string;
  imageUrl?: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open album ${title}`}
      className="w-36 shrink-0 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="aspect-square w-full overflow-hidden rounded-lg bg-card">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 size={24} className="text-muted" />
          </div>
        )}
      </div>
      <p className="mt-2 truncate text-sm text-heading">{title}</p>
      <p className="truncate text-xs text-soft">{artist}</p>
    </button>
  );
});
