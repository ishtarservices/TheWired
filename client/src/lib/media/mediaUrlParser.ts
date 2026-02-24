/** Recognized media file extensions */
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|mkv|avi|m3u8)$/i;
const AUDIO_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i;

/** URL pattern for media links in text content */
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

export type MediaType = "image" | "video" | "audio";

export interface ExtractedMedia {
  url: string;
  type: MediaType;
  /** The full match string in the original content (for stripping) */
  matchText: string;
}

/** Determine media type from URL extension/path */
function classifyUrl(url: string): MediaType | null {
  // Strip query params / fragments for extension check
  const path = url.split("?")[0].split("#")[0];

  if (IMAGE_EXTENSIONS.test(path)) return "image";
  if (VIDEO_EXTENSIONS.test(path)) return "video";
  if (AUDIO_EXTENSIONS.test(path)) return "audio";

  // Blossom servers often serve without extension -- check known patterns
  // Blossom URLs with content-type hints in path
  if (/blossom\.[^/]+\/[a-f0-9]{20,}/.test(url)) {
    // Without extension we can't know for sure; check if a neighboring
    // URL in the same note gives a hint.  Default to image for now,
    // but callers should refine with HEAD request or imeta tags.
    return null;
  }

  return null;
}

/**
 * Extract all media URLs from a note's text content.
 * Returns an array of ExtractedMedia with type classification.
 */
export function extractMediaUrls(content: string): ExtractedMedia[] {
  const results: ExtractedMedia[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(URL_REGEX)) {
    const url = cleanTrailingPunctuation(match[0]);
    if (seen.has(url)) continue;

    const type = classifyUrl(url);
    if (type) {
      seen.add(url);
      results.push({ url, type, matchText: match[0] });
    }
  }

  return results;
}

/** Check if content contains any media URLs */
export function hasMediaUrls(content: string): boolean {
  for (const match of content.matchAll(URL_REGEX)) {
    const url = cleanTrailingPunctuation(match[0]);
    if (classifyUrl(url)) return true;
  }
  return false;
}

/**
 * Strip media URLs from text content, returning clean text.
 * Collapses extra whitespace left behind.
 */
export function stripMediaUrls(content: string): string {
  const media = extractMediaUrls(content);
  let cleaned = content;

  for (const m of media) {
    // Remove the URL and any surrounding whitespace on the same line
    cleaned = cleaned.replace(m.matchText, "");
  }

  // Collapse multiple blank lines into at most one
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}

/** Remove trailing punctuation that's not part of the URL */
function cleanTrailingPunctuation(url: string): string {
  // Remove trailing characters that are common sentence-ending punctuation
  return url.replace(/[),.:;!?]+$/, "");
}
