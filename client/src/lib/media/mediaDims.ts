import { LRUCache } from "lru-cache";
import { stripMediaGrant } from "@ishtarservices/core";

/** Intrinsic pixel size of an image or video. */
export interface MediaDims {
  w: number;
  h: number;
}

/**
 * Sizes of media already loaded this session, keyed by URL without its
 * `?tk=` grant (the token rotates, the bytes don't). Lets a remounted message
 * reserve its media box up front instead of popping in and shifting the chat.
 */
const cache = new LRUCache<string, MediaDims>({ max: 2000 });

export function rememberMediaDims(url: string | undefined, w: number, h: number): void {
  if (!url || !(w > 0) || !(h > 0)) return;
  cache.set(stripMediaGrant(url), { w, h });
}

export function peekMediaDims(url: string | undefined): MediaDims | undefined {
  return url ? cache.get(stripMediaGrant(url)) : undefined;
}

/** Parse an imeta `dim` value ("WxH"). */
export function parseDim(dim: string | undefined): MediaDims | null {
  const m = dim ? /^(\d+)\s*x\s*(\d+)$/i.exec(dim.trim()) : null;
  if (!m) return null;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * `WxH` of an image or video file for its imeta `dim`, or undefined for other
 * types and failures. Reads the local preview URL, so nothing is fetched.
 */
export function fileMediaDim(file: File, previewUrl: string, timeoutMs = 5000): Promise<string | undefined> {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (typeof document === "undefined" || (!isImage && !isVideo)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    const done = (w?: number, h?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(w && h ? `${w}x${h}` : undefined);
    };
    const timer = setTimeout(() => done(), timeoutMs);
    if (isImage) {
      const img = new Image();
      img.onload = () => done(img.naturalWidth, img.naturalHeight);
      img.onerror = () => done();
      img.src = previewUrl;
    } else {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.onloadedmetadata = () => done(video.videoWidth, video.videoHeight);
      video.onerror = () => done();
      video.src = previewUrl;
    }
  });
}
