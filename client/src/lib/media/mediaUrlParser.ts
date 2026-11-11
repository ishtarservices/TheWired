import { matchEmbed } from "../content/embedPatterns";
import {
  classifyEventMediaUrl,
  hasSpaceTag,
  imetaByUrl,
  imetaFor,
  tokenizeEventMediaUrl,
  type MediaEventContext,
} from "./eventMedia";

/** URL pattern for media links in text content */
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

export type MediaType = "image" | "video" | "audio";

export interface ExtractedMedia {
  /** Render URL: carries the media grant for a space event's own-server blob. */
  url: string;
  type: MediaType;
  /** The full match string in the original content (for stripping) */
  matchText: string;
  /** imeta `fallback` URLs (load-error chain). */
  fallbacks?: string[];
  /** Event author, whose kind-10063 servers are tried by hash on error. */
  author?: string;
  /** From a space event: our server's copy is members-only (needs the grant). */
  gated?: boolean;
  /** imeta `dim` ("WxH"): reserves the box before the media loads. */
  dim?: string;
  /** imeta `image` / `thumb` preview frame (videos). */
  poster?: string;
}

/** Media type for a URL: extension, else (extensionless Blossom URL) the
 *  imeta `m` or a finished HEAD probe. Documents aren't gallery media. */
function classifyUrl(url: string, imeta: ReturnType<typeof imetaByUrl>): MediaType | null {
  const kind = classifyEventMediaUrl(url, imetaFor(imeta, url));
  return kind === "file" ? null : kind;
}

/**
 * Extract all media URLs from a note's text content. Pass the event (tags +
 * author) so extensionless blob URLs classify from imeta and space events get
 * their media-grant token (docs/MEDIA_STORAGE.md §5).
 */
export function extractMediaUrls(content: string, event?: MediaEventContext): ExtractedMedia[] {
  const results: ExtractedMedia[] = [];
  const seen = new Set<string>();
  const imeta = imetaByUrl(event?.tags);
  const gated = hasSpaceTag(event?.tags);

  for (const match of content.matchAll(URL_REGEX)) {
    const url = cleanTrailingPunctuation(match[0]);
    if (seen.has(url)) continue;

    const type = classifyUrl(url, imeta);
    if (type) {
      seen.add(url);
      const info = imetaFor(imeta, url);
      const fallbacks = info?.fallbacks;
      results.push({
        url: tokenizeEventMediaUrl(url, event),
        type,
        matchText: match[0],
        ...(fallbacks?.length ? { fallbacks } : {}),
        ...(info?.dim ? { dim: info.dim } : {}),
        ...(info?.poster && type === "video" ? { poster: tokenizeEventMediaUrl(info.poster, event) } : {}),
        ...(event?.pubkey ? { author: event.pubkey } : {}),
        ...(gated ? { gated } : {}),
      });
    }
  }

  return results;
}

/** Check if content contains any media URLs */
export function hasMediaUrls(content: string, event?: MediaEventContext): boolean {
  const imeta = imetaByUrl(event?.tags);
  for (const match of content.matchAll(URL_REGEX)) {
    const url = cleanTrailingPunctuation(match[0]);
    if (classifyUrl(url, imeta)) return true;
  }
  return false;
}

/**
 * Strip media URLs from text content, returning clean text.
 * Collapses extra whitespace left behind.
 */
export function stripMediaUrls(content: string, event?: MediaEventContext): string {
  const media = extractMediaUrls(content, event);
  let cleaned = content;

  for (const m of media) {
    // Remove the URL and any surrounding whitespace on the same line
    cleaned = cleaned.replace(m.matchText, "");
  }

  // Collapse multiple blank lines into at most one
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

/** Check if content contains any embeddable URLs (YouTube, Twitter, etc.) */
export function hasEmbedUrls(content: string): boolean {
  for (const match of content.matchAll(URL_REGEX)) {
    const url = cleanTrailingPunctuation(match[0]);
    if (matchEmbed(url)) return true;
  }
  return false;
}

/** Remove trailing punctuation that's not part of the URL */
function cleanTrailingPunctuation(url: string): string {
  // Remove trailing characters that are common sentence-ending punctuation
  return url.replace(/[),.:;!?]+$/, "");
}
