import { useCallback, useState } from "react";
import { orientationFromDims, type NaturalSize, type Orientation } from "./mediaLayout";
import { parseDim, peekMediaDims, rememberMediaDims } from "@/lib/media/mediaDims";

export interface MediaOrientationState {
  orientation: Orientation;
  /** width / height once known, else null */
  aspect: number | null;
  /** Intrinsic pixel size once known, else null. */
  natural: NaturalSize | null;
  /** Attach to `<img onLoad>` or `<video onLoadedMetadata>`. */
  onLoad: (e: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => void;
}

/**
 * Track media orientation. Seeds from an imeta `dim` ("WxH"), else from the
 * size this URL loaded at earlier in the session, so the box is correctly
 * shaped before the asset loads (no layout shift); otherwise resolves on the
 * element's load event from natural/intrinsic dimensions.
 */
export function useMediaOrientation(initialDim?: string, url?: string): MediaOrientationState {
  const [natural, setNatural] = useState<NaturalSize | null>(
    () => parseDim(initialDim) ?? peekMediaDims(url) ?? null,
  );

  const onLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => {
      const el = e.currentTarget;
      let w = 0;
      let h = 0;
      if (el instanceof HTMLImageElement) {
        w = el.naturalWidth;
        h = el.naturalHeight;
      } else if (el instanceof HTMLVideoElement) {
        w = el.videoWidth;
        h = el.videoHeight;
      }
      if (w > 0 && h > 0) {
        rememberMediaDims(url, w, h);
        setNatural((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      }
    },
    [url],
  );

  return {
    orientation: natural ? orientationFromDims(natural.w, natural.h) : "unknown",
    aspect: natural ? natural.w / natural.h : null,
    natural,
    onLoad,
  };
}
