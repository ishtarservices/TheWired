import { parse } from "nostr-tools/nip27";
import type { ProfilePointer, EventPointer, AddressPointer } from "nostr-tools/nip19";
import { matchEmbed, type EmbedMatch } from "./embedPatterns";
import {
  classifyEventMediaUrl,
  hasSpaceTag,
  imetaByUrl,
  imetaFor,
  isExtensionlessBlobUrl,
  tokenizeEventMediaUrl,
  type ImetaInfo,
  type ImetaMap,
  type MediaEventContext,
} from "@/lib/media/eventMedia";
import { isOwnBlobUrl } from "@ishtarservices/core";
import { ownBlossomOrigin } from "@/lib/api/blossom";

/** Load-error fallback sources carried with a media segment
 *  (docs/MEDIA_STORAGE.md §5): imeta `fallback` URLs and the author, whose
 *  kind-10063 servers are tried by hash. */
export interface MediaSource {
  fallbacks?: string[];
  author?: string;
  /** From a space event: our server's copy is members-only (needs the grant). */
  gated?: boolean;
}

/** Layout hints from the event's imeta: reserve the box before the media
 *  loads, and paint a video's preview frame. */
export interface MediaHints {
  /** imeta `dim` ("WxH"). */
  dim?: string;
  /** imeta `image` / `thumb` (videos). */
  poster?: string;
}

export type ContentSegment =
  | { type: "text"; text: string }
  | { type: "mention"; pubkey: string; relays?: string[] }
  | { type: "event-ref"; id: string; relays?: string[]; author?: string; kind?: number }
  | { type: "addr-ref"; identifier: string; pubkey: string; kind: number; relays?: string[] }
  | { type: "url"; url: string }
  | ({ type: "image"; url: string } & MediaSource & MediaHints)
  | ({ type: "video"; url: string } & MediaSource & MediaHints)
  | ({ type: "audio"; url: string } & MediaSource)
  | ({ type: "file"; url: string; filename: string } & MediaSource)
  /** An extensionless Blossom URL with no type hint: rendered after a HEAD probe. */
  | ({ type: "blob"; url: string } & MediaSource & MediaHints)
  | { type: "embed"; embed: EmbedMatch }
  | { type: "invite"; code: string }
  | { type: "hashtag"; value: string }
  | { type: "custom-emoji"; shortcode: string; url: string };

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

const RAW_URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Blob URLs on our own server that the NIP-27 parser left as text: it skips
 * hosts without a dot, which is exactly a dev build's http://localhost:9080.
 * Only own-origin sha URLs are lifted out, as media.
 */
function extractOwnBlobUrls(
  segments: ContentSegment[],
  event: MediaEventContext | undefined,
  imeta: ImetaMap,
): ContentSegment[] {
  const own = ownBlossomOrigin();
  const result: ContentSegment[] = [];
  for (const seg of segments) {
    if (seg.type !== "text" || !seg.text.includes("://")) {
      result.push(seg);
      continue;
    }
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    RAW_URL_RE.lastIndex = 0;
    while ((match = RAW_URL_RE.exec(seg.text)) !== null) {
      const url = match[0].replace(/[),.:;!?]+$/, "");
      if (!isOwnBlobUrl(url, own)) continue;
      if (match.index > lastIndex) result.push({ type: "text", text: seg.text.slice(lastIndex, match.index) });
      const info = imetaFor(imeta, url);
      result.push(mediaSegment(classifyEventMediaUrl(url, info) ?? "blob", url, event, info));
      lastIndex = match.index + url.length;
    }
    if (lastIndex === 0) result.push(seg);
    else if (lastIndex < seg.text.length) result.push({ type: "text", text: seg.text.slice(lastIndex) });
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

/** A media segment for `url` (classified by the caller), tokenized for the
 *  event and carrying its fallback sources. */
function mediaSegment(
  kind: "image" | "video" | "audio" | "file" | "blob",
  url: string,
  ctx: MediaEventContext | undefined,
  imeta: ImetaInfo | undefined,
): ContentSegment {
  const src: MediaSource = {};
  if (imeta?.fallbacks.length) src.fallbacks = imeta.fallbacks;
  if (ctx?.pubkey) src.author = ctx.pubkey;
  if (hasSpaceTag(ctx?.tags)) src.gated = true;
  const tokened = tokenizeEventMediaUrl(url, ctx);
  if (kind === "file") {
    const filename = url.split("/").pop()?.split("?")[0] || "document.pdf";
    return { type: "file", url: tokened, filename: /\.[a-z0-9]+$/i.test(filename) ? filename : `${filename}.pdf`, ...src };
  }
  if (kind === "audio") return { type: kind, url: tokened, ...src };
  const hints: MediaHints = {};
  if (imeta?.dim) hints.dim = imeta.dim;
  if (imeta?.poster) hints.poster = tokenizeEventMediaUrl(imeta.poster, ctx);
  return { type: kind, url: tokened, ...src, ...hints };
}

/**
 * Parse nostr content into typed segments using NIP-27. `event` (the tags and
 * author of the event the content came from) drives media handling: imeta
 * classification of extensionless blob URLs and the media-grant token for
 * space events (docs/MEDIA_STORAGE.md §5).
 */
export function parseContent(
  content: string,
  emojiTags?: string[][],
  event?: MediaEventContext,
): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const imeta = imetaByUrl(event?.tags);

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
        const info = imetaFor(imeta, url);
        const kind = classifyEventMediaUrl(url, info);
        if (kind) {
          segments.push(mediaSegment(kind, url, event, info));
        } else if (isExtensionlessBlobUrl(url)) {
          segments.push(mediaSegment("blob", url, event, info));
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
      case "video":
      case "audio":
        segments.push(mediaSegment(token.type, token.url, event, imetaFor(imeta, token.url)));
        break;

      default:
        // relay, emoji, etc. — render as text for now
        if ("url" in token && token.url) {
          segments.push({ type: "text", text: String(token.url) });
        }
    }
  }

  // Post-process: localhost URLs aren't parsed by NIP-27 — lift out our own
  // blob URLs (dev builds) and invite links from the text segments.
  let processed = extractInviteLinks(extractOwnBlobUrls(segments, event, imeta));

  // Post-process: replace :shortcode: patterns with custom-emoji segments (NIP-30)
  const emojiMap = buildEmojiMap(emojiTags);
  if (emojiMap) {
    processed = expandCustomEmojis(processed, emojiMap);
  }

  return processed;
}
