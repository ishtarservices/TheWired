import { useState } from "react";
import { Download } from "lucide-react";
import { MediaLightbox, downloadMedia } from "../ui/MediaLightbox";
import { MediaBackdrop } from "./MediaBackdrop";
import { useMediaOrientation } from "./useMediaOrientation";
import { FEED_ASPECT_CLAMP, type MediaDensity } from "./mediaLayout";

/** Per-density sizing: fixed height for the fitted (portrait) card + natural-image cap. */
const DENSITY: Record<MediaDensity, { fittedHeight: string; maxH: string }> = {
  feed: { fittedHeight: "h-[24rem]", maxH: "max-h-[24rem]" },
  expanded: { fittedHeight: "h-[32rem]", maxH: "max-h-[32rem]" },
  compact: { fittedHeight: "h-[15rem]", maxH: "max-h-[15rem]" },
  inline: { fittedHeight: "h-[15rem]", maxH: "max-h-60" },
};

export interface SmartImageProps {
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
export function SmartImage({
  url,
  alt = "",
  onOpen,
  dim,
  downloadable = true,
  density = "feed",
}: SmartImageProps) {
  const { aspect, onLoad } = useMediaOrientation(dim);
  const [errored, setErrored] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  if (errored) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-xs text-primary underline"
      >
        {url}
      </a>
    );
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
      onClick={() => downloadMedia(url)}
      className="absolute right-2 top-2 z-20 rounded-full bg-black/50 p-1.5 text-white/70 opacity-0 transition-all group-hover/media:opacity-100 hover:bg-black/70 hover:text-white"
      title="Download image"
    >
      <Download size={14} />
    </button>
  ) : null;

  // Inline (in-text) images stay small + natural — no card/backdrop.
  if (inline) {
    return (
      <>
        <span className="group/media relative inline-block max-w-xs overflow-hidden rounded-lg align-bottom">
          <img
            src={url}
            alt={alt}
            loading="lazy"
            onLoad={onLoad}
            onError={() => setErrored(true)}
            onClick={handleClick}
            className={`max-w-full ${d.maxH} cursor-zoom-in rounded-lg object-contain`}
          />
          {downloadBtn}
        </span>
        {lightbox && <MediaLightbox src={url} onClose={() => setLightbox(false)} />}
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
        {fitted && <MediaBackdrop src={url} active />}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onLoad={onLoad}
          onError={() => setErrored(true)}
          onClick={handleClick}
          className={`relative z-10 mx-auto block w-full ${fitted ? "h-full" : d.maxH} cursor-zoom-in object-contain`}
        />
        {downloadBtn}
      </div>
      {lightbox && <MediaLightbox src={url} onClose={() => setLightbox(false)} />}
    </>
  );
}
