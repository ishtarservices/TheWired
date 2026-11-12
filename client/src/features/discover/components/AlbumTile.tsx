import { memo } from "react";
import { Artwork } from "@/features/music/Artwork";

/** A project on the wall: the cover, then title and artist. Same proportions
 *  as the music section's project card, without its library actions. */
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
      aria-label={`Open project ${title}`}
      className="group flex w-full flex-col rounded-lg text-left outline-offset-4"
    >
      <Artwork
        src={imageUrl}
        title={title}
        className="aspect-square w-full rounded-lg shadow-[var(--shadow-sm)] transition-[filter,box-shadow] duration-200 group-hover:shadow-[var(--shadow-lg)] group-hover:brightness-90"
      />
      <span className="block w-full px-0.5 pt-2.5">
        <span className="block truncate text-[13px] font-medium text-heading">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">{artist}</span>
      </span>
    </button>
  );
});
