/**
 * Pure layout + orientation helpers for note media.
 *
 * Kept React-free so the decision logic (orientation, backdrop gating, gallery
 * shape) is cheaply unit-testable. See `useMediaOrientation` for the React glue
 * and `MediaGallery` for the renderer that consumes these.
 */

export type Orientation = "landscape" | "portrait" | "square" | "unknown";

/** Layout density / context a media item is rendered in. */
export type MediaDensity = "feed" | "expanded" | "compact" | "inline";

export interface AspectClamp {
  /** Minimum displayed aspect ratio (width / height) — the most portrait we go. */
  min: number;
  /** Maximum displayed aspect ratio (width / height) — the widest we go. */
  max: number;
}

/** Feed display clamp: between 4:5 portrait (0.8) and 16:9 landscape (~1.778). */
export const FEED_ASPECT_CLAMP: AspectClamp = { min: 0.8, max: 16 / 9 };

/** Within this tolerance of 1:1 we treat media as square. */
const SQUARE_TOLERANCE = 0.05;

/** Classify orientation from raw pixel dimensions. */
export function orientationFromDims(width: number, height: number): Orientation {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return "unknown";
  }
  const ratio = width / height;
  if (Math.abs(ratio - 1) <= SQUARE_TOLERANCE) return "square";
  return ratio > 1 ? "landscape" : "portrait";
}

/** Parse an imeta `dim` string ("WxH") into a numeric aspect ratio (w/h), or null. */
export function aspectFromDimString(dim?: string): number | null {
  if (!dim) return null;
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(dim.trim());
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (w <= 0 || h <= 0) return null;
  return w / h;
}

/** Parse an imeta `dim` string ("WxH") into an orientation. */
export function orientationFromDimString(dim?: string): Orientation {
  const m = dim ? /^(\d+)\s*x\s*(\d+)$/i.exec(dim.trim()) : null;
  if (!m) return "unknown";
  return orientationFromDims(parseInt(m[1], 10), parseInt(m[2], 10));
}

/**
 * Whether to paint the blurred backdrop. Only when the media's true aspect
 * noticeably mismatches what the clamped card can show (portrait or panorama).
 * A normal landscape image (min ≤ aspect ≤ max) → false → zero backdrop cost.
 */
export function needsBackdrop(
  aspect: number,
  clamp: AspectClamp = FEED_ASPECT_CLAMP,
): boolean {
  if (!Number.isFinite(aspect) || aspect <= 0) return false;
  return aspect < clamp.min || aspect > clamp.max;
}

/** Clamp the displayed *card* aspect ratio so hyper-tall/wide media can't dominate. */
export function clampedCardAspect(
  aspect: number,
  clamp: AspectClamp = FEED_ASPECT_CLAMP,
): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return clamp.max;
  return Math.min(Math.max(aspect, clamp.min), clamp.max);
}

export type GalleryLayout =
  | { kind: "single" }
  | { kind: "grid"; tiles: number; columns: number; overflow: number };

/**
 * Map an image count to a layout descriptor.
 *  - 1  → single (hero / blurred-fill)
 *  - 2  → 1×2 grid
 *  - 3  → 1 big + 2 stacked (2 columns)
 *  - 4  → 2×2 grid
 *  - 5+ → 2×2 grid; last visible tile shows "+N" (overflow = count - 4)
 */
export function galleryLayout(count: number): GalleryLayout {
  if (count <= 1) return { kind: "single" };
  if (count === 2) return { kind: "grid", tiles: 2, columns: 2, overflow: 0 };
  if (count === 3) return { kind: "grid", tiles: 3, columns: 2, overflow: 0 };
  if (count === 4) return { kind: "grid", tiles: 4, columns: 2, overflow: 0 };
  return { kind: "grid", tiles: 4, columns: 2, overflow: count - 4 };
}
