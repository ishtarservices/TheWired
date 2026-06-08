import { useCallback, useState } from "react";
import {
  aspectFromDimString,
  orientationFromDimString,
  orientationFromDims,
  type Orientation,
} from "./mediaLayout";

export interface MediaOrientationState {
  orientation: Orientation;
  /** width / height once known, else null */
  aspect: number | null;
  /** Attach to `<img onLoad>` or `<video onLoadedMetadata>`. */
  onLoad: (e: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => void;
}

/**
 * Track media orientation. Seeds from an imeta `dim` ("WxH") when available so
 * the box is correctly shaped before the asset loads (no layout shift);
 * otherwise resolves on the element's load event from natural/intrinsic
 * dimensions.
 */
export function useMediaOrientation(initialDim?: string): MediaOrientationState {
  const [orientation, setOrientation] = useState<Orientation>(() =>
    orientationFromDimString(initialDim),
  );
  const [aspect, setAspect] = useState<number | null>(() =>
    aspectFromDimString(initialDim),
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
        setAspect(w / h);
        setOrientation(orientationFromDims(w, h));
      }
    },
    [],
  );

  return { orientation, aspect, onLoad };
}
