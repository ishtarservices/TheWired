import { galleryLayout } from "./mediaLayout";
import { useMediaFallback, type MediaFallbackSources } from "./useMediaFallback";
import { MediaUnavailable } from "./MediaUnavailable";

export interface MediaGridImage extends MediaFallbackSources {
  url: string;
  dim?: string;
}

export interface MediaGridProps {
  images: MediaGridImage[];
  /** Open the gallery lightbox at the given image index. */
  onOpen: (index: number) => void;
  /** `chat`: a compact, width-capped grid for chat / DM attachments. */
  size?: "feed" | "chat";
}

function GridTile({
  image,
  overflow,
  spanClass,
  onOpen,
}: {
  image: MediaGridImage;
  /** When > 0, render a "+N more" overlay (last visible tile). */
  overflow: number;
  spanClass?: string;
  onOpen: () => void;
}) {
  const media = useMediaFallback(image.url, image);
  return (
    <button
      onClick={onOpen}
      className={`group relative h-full w-full overflow-hidden bg-surface ${spanClass ?? ""}`}
    >
      {media.failed ? (
        <MediaUnavailable kind="image" compact className="rounded-none border-0" />
      ) : media.src ? (
        <img
          src={media.src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={media.onError}
          className={`h-full w-full object-cover transition-transform group-hover:scale-[1.03] ${media.retrying ? "invisible" : ""}`}
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
export function MediaGrid({ images, onOpen, size = "feed" }: MediaGridProps) {
  const layout = galleryLayout(images.length);
  if (layout.kind === "single") {
    // Defensive — callers route single images to SmartImage.
    return null;
  }

  const visible = images.slice(0, layout.tiles);

  // 3-up = one tall tile + two stacked; others are a uniform 2-col grid.
  const isThree = layout.tiles === 3;
  // Chat: the grid keeps a shape instead of a fixed height (square tiles for
  // two, a tall lead tile for three, a 2×2 block for four), capped to the
  // chat media width.
  const height =
    size === "chat"
      ? layout.tiles === 2
        ? "aspect-[2/1]"
        : layout.tiles === 3
          ? "aspect-[3/2]"
          : "aspect-[4/3]"
      : "h-72";
  const containerClass = isThree
    ? `grid ${height} grid-cols-2 grid-rows-2 gap-1`
    : layout.tiles === 2
      ? `grid ${height} grid-cols-2 gap-1`
      : `grid ${height} grid-cols-2 grid-rows-2 gap-1`;

  return (
    <div className={size === "chat" ? "w-full max-w-[26rem] overflow-hidden rounded-xl" : "overflow-hidden rounded-lg"}>
      <div className={containerClass}>
        {visible.map((img, i) => {
          const isLast = i === visible.length - 1;
          return (
            <GridTile
              key={img.url}
              image={img}
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
