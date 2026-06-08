import { useState } from "react";
import { galleryLayout } from "./mediaLayout";

export interface MediaGridImage {
  url: string;
  dim?: string;
}

export interface MediaGridProps {
  images: MediaGridImage[];
  /** Open the gallery lightbox at the given image index. */
  onOpen: (index: number) => void;
}

function GridTile({
  url,
  overflow,
  spanClass,
  onOpen,
}: {
  url: string;
  /** When > 0, render a "+N more" overlay (last visible tile). */
  overflow: number;
  spanClass?: string;
  onOpen: () => void;
}) {
  const [errored, setErrored] = useState(false);
  return (
    <button
      onClick={onOpen}
      className={`group relative h-full w-full overflow-hidden bg-surface ${spanClass ?? ""}`}
    >
      {!errored ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setErrored(true)}
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
        />
      ) : (
        <div className="h-full w-full bg-surface" />
      )}
      <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/15" />
      {overflow > 0 && (
        <div className="absolute inset-0 grid place-items-center bg-black/55">
          <span className="text-lg font-semibold text-white">+{overflow}</span>
        </div>
      )}
    </button>
  );
}

/**
 * Smart grid for 2+ images (X / Instagram pattern). Uniform `object-cover` tiles
 * — cropping is intentional and uniform here; tapping any tile opens the full,
 * uncropped image in the swipeable lightbox. 5+ images show "+N" on the last tile.
 */
export function MediaGrid({ images, onOpen }: MediaGridProps) {
  const layout = galleryLayout(images.length);
  if (layout.kind === "single") {
    // Defensive — callers route single images to SmartImage.
    return null;
  }

  const visible = images.slice(0, layout.tiles);

  // 3-up = one tall tile + two stacked; others are a uniform 2-col grid.
  const isThree = layout.tiles === 3;
  const containerClass = isThree
    ? "grid h-72 grid-cols-2 grid-rows-2 gap-1"
    : layout.tiles === 2
      ? "grid h-72 grid-cols-2 gap-1"
      : "grid h-72 grid-cols-2 grid-rows-2 gap-1";

  return (
    <div className="overflow-hidden rounded-lg">
      <div className={containerClass}>
        {visible.map((img, i) => {
          const isLast = i === visible.length - 1;
          return (
            <GridTile
              key={img.url}
              url={img.url}
              overflow={isLast ? layout.overflow : 0}
              spanClass={isThree && i === 0 ? "row-span-2" : undefined}
              onOpen={() => onOpen(i)}
            />
          );
        })}
      </div>
    </div>
  );
}
