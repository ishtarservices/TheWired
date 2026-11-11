// Media URLs as an EVENT carries them (docs/MEDIA_STORAGE.md §5). The parse
// chokepoints (parseContent, mediaUrlParser, imetaParser, EmbeddedNote) call
// in here once, so every consumer downstream gets the same URL:
//
//  - Token: a members-only space blob on our server needs the viewer's media
//    grant as `?tk=`. Added ONLY for events with an `h` tag and ONLY to our own
//    origin's sha URLs (`withMediaGrant`) — never sent to a third-party host.
//  - Classification: extension first; an extensionless sha URL uses the
//    event's imeta `m`, then a cached HEAD probe result.
//  - Fallbacks: imeta `fallback` URLs travel with the media for the
//    load-error chain.

import { isOwnBlobUrl, parseBlobUrl, withMediaGrant } from "@ishtarservices/core";
import { ownBlossomOrigin } from "@/lib/api/blossom";
import { getMediaGrant } from "./mediaGrant";
import { peekProbedType } from "./mediaProbe";

/** The parts of an event the media helpers read. */
export interface MediaEventContext {
  tags?: string[][];
  pubkey?: string;
}

export interface ImetaInfo {
  mime?: string;
  fallbacks: string[];
  dim?: string;
  /** `image` (or `thumb`) preview frame, http(s) only. */
  poster?: string;
}

export type MediaKind = "image" | "video" | "audio" | "file";

/** Does the event belong to a space (a valued `h` tag)? */
export function hasSpaceTag(tags: readonly string[][] | undefined): boolean {
  return !!tags?.some((t) => t[0] === "h" && !!t[1]);
}

function urlKey(url: string): string {
  try {
    return new URL(url).toString();
  } catch {
    return url;
  }
}

/** imeta entries by url; look up with {@link imetaFor} (keys are normalized,
 *  as content parsers may hand back a re-serialized URL). */
export type ImetaMap = Map<string, ImetaInfo>;

export function imetaFor(map: ImetaMap, url: string): ImetaInfo | undefined {
  return map.get(urlKey(url));
}

/** imeta (NIP-92) entries keyed by url. Every `fallback` is kept. */
export function imetaByUrl(tags: readonly string[][] | undefined): ImetaMap {
  const out = new Map<string, ImetaInfo>();
  for (const tag of tags ?? []) {
    if (tag[0] !== "imeta") continue;
    let url: string | undefined;
    const info: ImetaInfo = { fallbacks: [] };
    for (let i = 1; i < tag.length; i++) {
      const entry = tag[i];
      const sp = entry.indexOf(" ");
      if (sp === -1) continue;
      const key = entry.slice(0, sp);
      const value = entry.slice(sp + 1).trim();
      if (!value) continue;
      if (key === "url") url = value;
      else if (key === "m") info.mime = value.toLowerCase();
      else if (key === "fallback") info.fallbacks.push(value);
      else if (key === "dim") info.dim = value;
      else if ((key === "image" || (key === "thumb" && !info.poster)) && isHttpUrl(value)) info.poster = value;
    }
    if (url && !out.has(urlKey(url))) out.set(urlKey(url), info);
  }
  return out;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** The media grant for this event's own-origin sha URL, or the URL unchanged.
 *  Reading the grant may start a background mint; components re-render via
 *  `useMediaGrant`. */
export function tokenizeEventMediaUrl(url: string, ctx: MediaEventContext | undefined): string {
  if (!hasSpaceTag(ctx?.tags)) return url;
  const own = ownBlossomOrigin();
  if (!isOwnBlobUrl(url, own)) return url;
  return withMediaGrant(url, getMediaGrant(), own);
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|m3u8|mkv|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i;
const DOC_EXT = /\.pdf$/i;

/** image / video / audio / file (pdf) from a MIME type. */
export function kindFromMime(mime: string | null | undefined): MediaKind | null {
  if (!mime) return null;
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/") || m === "application/x-mpegurl" || m === "application/vnd.apple.mpegurl") {
    return "video";
  }
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "file";
  return null;
}

/** Classify by the URL's path extension. */
export function kindFromExtension(url: string): MediaKind | null {
  const path = url.split("#")[0].split("?")[0];
  if (IMAGE_EXT.test(path)) return "image";
  if (VIDEO_EXT.test(path)) return "video";
  if (AUDIO_EXT.test(path)) return "audio";
  if (DOC_EXT.test(path)) return "file";
  return null;
}

/** Is this an extensionless Blossom sha URL (any server)? */
export function isExtensionlessBlobUrl(url: string): boolean {
  const p = parseBlobUrl(url);
  return p !== null && !p.ext;
}

/**
 * Media kind for a URL found in an event: extension, then (for an
 * extensionless sha URL) the imeta `m`, then a finished HEAD probe. Null when
 * it isn't (known to be) media — an unprobed extensionless blob included.
 */
export function classifyEventMediaUrl(url: string, imeta?: ImetaInfo): MediaKind | null {
  const byExt = kindFromExtension(url);
  if (byExt) return byExt;
  if (!isExtensionlessBlobUrl(url)) return null;
  return kindFromMime(imeta?.mime) ?? kindFromMime(peekProbedType(url));
}
