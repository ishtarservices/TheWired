import { useState, useEffect } from "react";
import {
  generateVideoThumbnail,
  getCachedThumbnail,
} from "../lib/media/videoThumbnail";

/**
 * Hook that auto-generates a thumbnail for a video URL.
 * Returns the provided thumbnailUrl if available, otherwise generates one.
 * Returns undefined while loading.
 */
export function useVideoThumbnail(
  videoUrl: string,
  providedThumbnailUrl?: string,
): string | undefined {
  const [generatedThumb, setGeneratedThumb] = useState<string | undefined>(
    () => getCachedThumbnail(videoUrl),
  );

  useEffect(() => {
    // Skip generation if we already have a provided thumbnail
    if (providedThumbnailUrl) return;
    // Skip if already cached
    if (getCachedThumbnail(videoUrl)) return;

    let cancelled = false;
    generateVideoThumbnail(videoUrl).then((dataUrl) => {
      if (!cancelled && dataUrl) {
        setGeneratedThumb(dataUrl);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [videoUrl, providedThumbnailUrl]);

  return providedThumbnailUrl || generatedThumb;
}
