import { memo, useState } from "react";
import { Download } from "lucide-react";
import { MediaLightbox, downloadMedia } from "../ui/MediaLightbox";
import { MediaBackdrop } from "./MediaBackdrop";
import { useMediaOrientation } from "./useMediaOrientation";
import {
  CHAT_IMAGE_PLACEHOLDER,
  FEED_ASPECT_CLAMP,
  boundedMediaSize,
  type MediaDensity,
} from "./mediaLayout";
import { useMediaFallback, type MediaFallbackSources } from "./useMediaFallback";
import { MediaUnavailable } from "./MediaUnavailable";

/** Per-density sizing: fixed height for the fitted (portrait) card + natural-image cap. */
const DENSITY: Record<MediaDensity, { fittedHeight: string; maxH: string }> = {
  feed: { fittedHeight: "h-[24rem]", maxH: "max-h-[24rem]" },
  expanded: { fittedHeight: "h-[32rem]", maxH: "max-h-[32rem]" },
  compact: { fittedHeight: "h-[15rem]", maxH: "max-h-[15rem]" },
  inline: { fittedHeight: "h-[15rem]", maxH: "max-h-60" },
  // Unused: chat cards are sized from the media's own shape (`boundedMediaSize`).
  chat: { fittedHeight: "", maxH: "" },
};

export interface SmartImageProps extends MediaFallbackSources {
  url: string;
  alt?: string;
  /** Click handler — e.g. a gallery lightbox opener. If omitted, opens its own lightbox. */
  onOpen?: () => void;
  /** Optional imeta `dim` ("WxH") for up-front orientation (picture / kind:20 events). */
  dim?: string;
  /** Show the hover download button (default true). */
  downloadable?: boolean;
  /** Layout density / context. */
  density?: MediaDensity;
}

/**
 * Orientation-aware single image.
 *  - Landscape / square (and pre-load) → natural width, height-capped, no backdrop
 *    (the spaces-feed baseline — zero extra cost).
 *  - Portrait / panorama → shown whole (`object-contain`) inside a consistent card,
 *    with a blurred copy of itself filling the gaps (see `MediaBackdrop`).
 */
export const SmartImage = memo(function SmartImage({
  url,
  alt = "",
  onOpen,
  dim,
  downloadable = true,
  density = "feed",
  fallbacks,
  author,
  gated,
}: SmartImageProps) {
  const { aspect, natural, onLoad } = useMediaOrientation(dim, url);
  const [lightbox, setLightbox] = useState(false);
  // Load-error chain: grant re-mint → by-hash fallbacks → unavailable tile.
  const media = useMediaFallback(url, { fallbacks, author, gated });
  const src = media.src;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  if (media.failed) {
    return <MediaUnavailable kind="image" className={density === "inline" ? "mt-1" : ""} />;
  }

  const handleClick = () => (onOpen ? onOpen() : setLightbox(true));
  const d = DENSITY[density];
  const inline = density === "inline";

  // Inline (in-text) images stay natural & width-capped — no fitted/backdrop card.
  const isPortrait = !inline && aspect != null && aspect < FEED_ASPECT_CLAMP.min;
  const isPanorama = !inline && aspect != null && aspect > FEED_ASPECT_CLAMP.max;
  const fitted = isPortrait || isPanorama;

  const downloadBtn = downloadable ? (
    <button
      onClick={() => src && downloadMedia(src)}
      className="absolute right-2 top-2 z-20 rounded-full bg-black/50 p-1.5 text-white/70 opacity-0 transition-all group-hover/media:opacity-100 hover:bg-black/70 hover:text-white"
      title="Download image"
    >
      <Download size={14} />
    </button>
  ) : null;

  // Chat / DM attachment: a card at the image's own shape, bounded to the
  // chat box and reserved up front (imeta `dim` or an earlier load) so the
  // message doesn't jump when the image arrives. Until the size is known it
  // holds a placeholder shape with a skeleton.
  if (density === "chat") {
    const size = boundedMediaSize(natural ?? CHAT_IMAGE_PLACEHOLDER);
    const loaded = !!src && loadedSrc === src;
    return (
      <>
        <div
          className="group/media relative max-w-full overflow-hidden rounded-xl bg-surface ring-1 ring-inset ring-border/60"
          style={{ width: size.width, aspectRatio: size.aspect }}
        >
          {!loaded && <div className="absolute inset-0 animate-pulse bg-surface-hover" />}
          {size.fitted && loaded && <MediaBackdrop src={src} active />}
          {src && (
            <img
              src={src}
              alt={alt}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={(e) => {
                onLoad(e);
                setLoadedSrc(src);
              }}
              onError={media.onError}
              onClick={handleClick}
              className={`relative z-10 block h-full w-full cursor-zoom-in object-contain transition-opacity duration-200 ${
                loaded && !media.retrying ? "opacity-100" : "opacity-0"
              }`}
            />
          )}
          {downloadBtn}
        </div>
        {lightbox && src && <MediaLightbox src={src} onClose={() => setLightbox(false)} />}
      </>
    );
  }

  // Inline (in-text) images stay small + natural — no card/backdrop.
  if (inline) {
    return (
      <>
        <span className="group/media relative inline-block max-w-xs overflow-hidden rounded-lg align-bottom">
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onLoad={onLoad}
            onError={media.onError}
            onClick={handleClick}
            className={`max-w-full ${d.maxH} cursor-zoom-in rounded-lg object-contain ${media.retrying ? "invisible" : ""}`}
          />
          {downloadBtn}
        </span>
        {lightbox && src && <MediaLightbox src={src} onClose={() => setLightbox(false)} />}
      </>
    );
  }

  // One full-width card for every aspect. `object-contain` keeps the image
  // centered and uncropped by construction (no `mx-auto`, which is fragile in a
  // flex column). Portrait/panorama get a definite box + blurred backdrop fill;
  // landscape/square are media-driven up to the height cap. Full-width (not a
  // shrink-to-fit inline-block) so image & video stay consistently aligned.
  const boxClass = isPortrait ? d.fittedHeight : isPanorama ? "aspect-[16/9]" : "";
  return (
    <>
      <div className={`group/media relative w-full overflow-hidden rounded-lg bg-surface ${boxClass}`}>
        {fitted && src && <MediaBackdrop src={src} active />}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={onLoad}
          onError={media.onError}
          onClick={handleClick}
          className={`relative z-10 mx-auto block w-full ${fitted ? "h-full" : d.maxH} cursor-zoom-in object-contain ${media.retrying ? "invisible" : ""} ${src ? "" : "min-h-24"}`}
        />
        {downloadBtn}
      </div>
      {lightbox && src && <MediaLightbox src={src} onClose={() => setLightbox(false)} />}
    </>
  );
});
