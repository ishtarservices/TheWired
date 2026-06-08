import { useEffect, useState } from "react";
import type { ExtractedMedia } from "@/lib/media/mediaUrlParser";
import { imageCache } from "@/lib/cache/imageCache";
import { MediaLightbox } from "../ui/MediaLightbox";
import { SmartImage } from "./SmartImage";
import { SmartVideo } from "./SmartVideo";
import { MediaGrid } from "./MediaGrid";
import type { MediaDensity } from "./mediaLayout";

/** Per-URL imeta hints (from video / picture events). */
export interface MediaImetaHint {
  dim?: string;
  blurhash?: string;
  poster?: string;
}

export interface MediaGalleryProps {
  media: ExtractedMedia[];
  /** Optional per-URL imeta hints, keyed by url. */
  imeta?: Record<string, MediaImetaHint>;
  density?: MediaDensity;
}

/**
 * Public entry point for rendering a note's media. Handles single vs. grid
 * images, stacked videos, audio, and a shared swipeable lightbox across the
 * post's images. Returns null for empty media.
 *
 *  - 1 image  → SmartImage (blurred-fill, no crop)
 *  - 2+ images → MediaGrid (tap a tile → lightbox)
 *  - videos    → stacked SmartVideo (orientation-aware)
 *  - audio     → native <audio>
 */
export function MediaGallery({ media, imeta, density = "feed" }: MediaGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");
  const audios = media.filter((m) => m.type === "audio");
  const imageUrls = images.map((m) => m.url);

  // Warm the decode cache for this post's images (idempotent).
  useEffect(() => {
    const urls = media.filter((m) => m.type === "image").map((m) => m.url);
    if (urls.length > 0) imageCache.preloadMany(urls);
  }, [media]);

  if (media.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {images.length === 1 && (
        <SmartImage
          url={images[0].url}
          dim={imeta?.[images[0].url]?.dim}
          density={density}
          onOpen={() => setLightboxIndex(0)}
        />
      )}

      {images.length >= 2 && (
        <MediaGrid
          images={images.map((m) => ({ url: m.url, dim: imeta?.[m.url]?.dim }))}
          onOpen={(i) => setLightboxIndex(i)}
        />
      )}

      {videos.map((m) => (
        <SmartVideo
          key={m.url}
          url={m.url}
          poster={imeta?.[m.url]?.poster}
          dim={imeta?.[m.url]?.dim}
          density={density}
        />
      ))}

      {audios.map((m) => (
        <audio key={m.url} src={m.url} controls className="w-full" />
      ))}

      {lightboxIndex != null && imageUrls.length > 0 && (
        <MediaLightbox
          srcs={imageUrls}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
