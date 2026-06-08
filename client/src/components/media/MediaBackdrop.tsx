interface MediaBackdropProps {
  /** Same URL as the foreground media (image src or video poster). */
  src: string;
  /** Render the layer only when the media doesn't fill the card. */
  active: boolean;
}

/**
 * Blurred fill layer: a scaled, blurred copy of the foreground media that fills
 * the empty space around contained portrait / panorama media.
 *
 * Cost guards:
 *  - Renders nothing when `active` is false (normal landscape media → no layer).
 *  - Reuses the same already-decoded `src` (no extra network / decode).
 *  - Static layer — composited once, no per-frame cost.
 *
 * Must live inside an `overflow-hidden` parent so the blur is clipped to the card.
 */
export function MediaBackdrop({ src, active }: MediaBackdropProps) {
  if (!active) return null;
  return (
    <>
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        loading="lazy"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl"
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-black/25" />
    </>
  );
}
