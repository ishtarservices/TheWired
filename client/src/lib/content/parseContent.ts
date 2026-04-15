import { parse } from "nostr-tools/nip27";
import type { ProfilePointer, EventPointer, AddressPointer } from "nostr-tools/nip19";
import { matchEmbed, type EmbedMatch } from "./embedPatterns";

export type ContentSegment =
  | { type: "text"; text: string }
  | { type: "mention"; pubkey: string; relays?: string[] }
  | { type: "event-ref"; id: string; relays?: string[]; author?: string; kind?: number }
  | { type: "addr-ref"; identifier: string; pubkey: string; kind: number; relays?: string[] }
  | { type: "url"; url: string }
  | { type: "image"; url: string }
  | { type: "video"; url: string }
  | { type: "audio"; url: string }
  | { type: "file"; url: string; filename: string }
  | { type: "embed"; embed: EmbedMatch }
  | { type: "invite"; code: string }
  | { type: "hashtag"; value: string }
  | { type: "custom-emoji"; shortcode: string; url: string };

const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|svg|avif|bmp)(\?.*)?$/i;
const VIDEO_EXTS = /\.(mp4|webm|mov|m3u8|mkv|avi)(\?.*)?$/i;
const AUDIO_EXTS = /\.(mp3|wav|ogg|flac|aac|m4a|opus)(\?.*)?$/i;
const DOC_EXTS = /\.(pdf)(\?.*)?$/i;
const INVITE_RE = /\/invite\/([A-Za-z0-9_-]+)/;
/** Matches a full invite URL (localhost or any domain) embedded in text */
const INVITE_URL_RE = /https?:\/\/[^\s]+\/invite\/([A-Za-z0-9_-]+)/g;

/** Type guard: pointer is a ProfilePointer (has pubkey, no id) */
function isProfilePointer(p: ProfilePointer | EventPointer | AddressPointer): p is ProfilePointer {
  return "pubkey" in p && !("id" in p) && !("identifier" in p);
}

/** Type guard: pointer is an EventPointer (has id) */
function isEventPointer(p: ProfilePointer | EventPointer | AddressPointer): p is EventPointer {
  return "id" in p;
}

/** Type guard: pointer is an AddressPointer (has identifier + pubkey + kind) */
function isAddressPointer(p: ProfilePointer | EventPointer | AddressPointer): p is AddressPointer {
  return "identifier" in p && "pubkey" in p && "kind" in p;
}

/** Build a shortcode→URL map from NIP-30 emoji tags */
function buildEmojiMap(emojiTags?: string[][]): Map<string, string> | null {
  if (!emojiTags || emojiTags.length === 0) return null;
  const map = new Map<string, string>();
  for (const tag of emojiTags) {
    if (tag[0] === "emoji" && tag[1] && tag[2]) {
      map.set(tag[1], tag[2]);
    }
  }
  return map.size > 0 ? map : null;
}

const SHORTCODE_RE = /:([a-zA-Z0-9_]+):/g;

/** Replace :shortcode: patterns in text segments with custom-emoji segments */
function expandCustomEmojis(segments: ContentSegment[], emojiMap: Map<string, string>): ContentSegment[] {
  const result: ContentSegment[] = [];
  for (const seg of segments) {
    if (seg.type !== "text") {
      result.push(seg);
      continue;
    }
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    SHORTCODE_RE.lastIndex = 0;
    while ((match = SHORTCODE_RE.exec(seg.text)) !== null) {
      const shortcode = match[1];
      const url = emojiMap.get(shortcode);
      if (!url) continue;
      // Push preceding text
      if (match.index > lastIndex) {
        result.push({ type: "text", text: seg.text.slice(lastIndex, match.index) });
      }
      result.push({ type: "custom-emoji", shortcode, url });
      lastIndex = match.index + match[0].length;
    }
    // Push remaining text
    if (lastIndex < seg.text.length) {
      result.push({ type: "text", text: seg.text.slice(lastIndex) });
    } else if (lastIndex === 0) {
      result.push(seg);
    }
  }
  return result;
}

/** Extract invite URLs from text segments that the NIP-27 parser missed (e.g. localhost URLs) */
function extractInviteLinks(segments: ContentSegment[]): ContentSegment[] {
  const result: ContentSegment[] = [];
  for (const seg of segments) {
    if (seg.type !== "text") {
      result.push(seg);
      continue;
    }
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    INVITE_URL_RE.lastIndex = 0;
    while ((match = INVITE_URL_RE.exec(seg.text)) !== null) {
      // Push preceding text
      if (match.index > lastIndex) {
        result.push({ type: "text", text: seg.text.slice(lastIndex, match.index) });
      }
      result.push({ type: "invite", code: match[1] });
      lastIndex = match.index + match[0].length;
    }
    // Push remaining text
    if (lastIndex < seg.text.length) {
      result.push({ type: "text", text: seg.text.slice(lastIndex) });
    } else if (lastIndex === 0) {
      result.push(seg);
    }
  }
  return result;
}

/** Parse nostr content into typed segments using NIP-27 */
export function parseContent(content: string, emojiTags?: string[][]): ContentSegment[] {
  const segments: ContentSegment[] = [];

  for (const token of parse(content)) {
    switch (token.type) {
      case "text":
        if (token.text) segments.push({ type: "text", text: token.text });
        break;

      case "reference": {
        const ptr = token.pointer;
        if (isAddressPointer(ptr)) {
          segments.push({
            type: "addr-ref",
            identifier: ptr.identifier,
            pubkey: ptr.pubkey,
            kind: ptr.kind,
            relays: ptr.relays,
          });
        } else if (isEventPointer(ptr)) {
          segments.push({
            type: "event-ref",
            id: ptr.id,
            relays: ptr.relays,
            author: ptr.author,
            kind: ptr.kind,
          });
        } else if (isProfilePointer(ptr)) {
          segments.push({
            type: "mention",
            pubkey: ptr.pubkey,
            relays: ptr.relays,
          });
        }
        break;
      }

      case "hashtag":
        segments.push({ type: "hashtag", value: token.value });
        break;

      case "url": {
        const url = token.url;
        if (IMAGE_EXTS.test(url)) {
          segments.push({ type: "image", url });
        } else if (VIDEO_EXTS.test(url)) {
          segments.push({ type: "video", url });
        } else if (AUDIO_EXTS.test(url)) {
          segments.push({ type: "audio", url });
        } else if (DOC_EXTS.test(url)) {
          const filename = url.split("/").pop()?.split("?")[0] || "document.pdf";
          segments.push({ type: "file", url, filename });
        } else {
          const inviteMatch = url.match(INVITE_RE);
          if (inviteMatch) {
            segments.push({ type: "invite", code: inviteMatch[1] });
          } else {
            const embed = matchEmbed(url);
            if (embed) {
              segments.push({ type: "embed", embed });
            } else {
              segments.push({ type: "url", url });
            }
          }
        }
        break;
      }

      case "image":
        segments.push({ type: "image", url: token.url });
        break;

      case "video":
        segments.push({ type: "video", url: token.url });
        break;

      case "audio":
        segments.push({ type: "audio", url: token.url });
        break;

      default:
        // relay, emoji, etc. — render as text for now
        if ("url" in token && token.url) {
          segments.push({ type: "text", text: String(token.url) });
        }
    }
  }

  // Post-process: extract invite links from text segments (localhost URLs aren't parsed by NIP-27)
  let processed = extractInviteLinks(segments);

  // Post-process: replace :shortcode: patterns with custom-emoji segments (NIP-30)
  const emojiMap = buildEmojiMap(emojiTags);
  if (emojiMap) {
    processed = expandCustomEmojis(processed, emojiMap);
  }

  return processed;
}
