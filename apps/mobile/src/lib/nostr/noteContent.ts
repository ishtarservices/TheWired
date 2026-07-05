// Note-content splitting for the v1 NoteCard: pull image URLs out of the
// text so they render as media instead of links. Deliberately simple — the
// desktop RichContent pipeline (mentions, embeds, custom emoji) ports with
// the shared core.

const IMAGE_URL_RE = /https?:\/\/[^\s<>"']+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^\s<>"']*)?/gi;

export interface SplitNoteContent {
  /** Content with image URLs removed (whitespace collapsed at the seams). */
  text: string;
  /** Image URLs in appearance order (deduped). */
  images: string[];
}

export function splitNoteContent(content: string): SplitNoteContent {
  const images: string[] = [];
  const text = content
    .replace(IMAGE_URL_RE, (url) => {
      const safe = safeImageUri(url);
      if (safe && !images.includes(safe)) images.push(safe);
      return "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, images };
}

/**
 * Event content and kind-0 picture/banner fields are attacker-controlled.
 * Normalize through WHATWG URL (percent-encodes what iOS's NSURL parser
 * rejects — raw unicode, spaces) and allowlist http(s). Anything unparseable
 * returns undefined so <Image> never sees it (RCTImageManager redboxes on
 * malformed URIs in dev).
 */
export function safeImageUri(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}
