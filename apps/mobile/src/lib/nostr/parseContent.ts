// ─── Note-content tokenizer ──────────────────────────────────────────
// Mobile port of the desktop parse pipeline (client/src/lib/content/
// parseContent.ts): nostr-tools/nip27 does the scanning (nostr:-prefixed
// refs, URLs, hashtags), we map its blocks onto the segment vocabulary the
// NoteText renderer understands, then a bare-bech32 post-pass catches
// npub1…/nevent1… without the nostr: prefix (pasted refs appear bare in the
// wild; nip27 only matches the prefixed form). Pure TS — unit-tested.
//
// Relay hints inside nevent/nprofile/naddr are attacker-controlled: they
// are sanitized HERE (public wss:// only) so downstream consumers only ever
// see clean hints. (engine.fetchEvents currently has no per-call relay
// param, so hints are carried but not dialed — kept for the future
// hint-dialing path and for parity with the desktop contract.)

import { nip19 } from "nostr-tools";
import { parse } from "nostr-tools/nip27";
import type {
  AddressPointer,
  EventPointer,
  ProfilePointer,
} from "nostr-tools/nip19";

import { safeImageUri } from "./noteContent";
import { isSafePeerRelayUrl } from "./relayUrl";

export type ContentSegment =
  | { type: "text"; text: string }
  | { type: "mention"; pubkey: string; relays?: string[] }
  | { type: "event-ref"; id: string; relays?: string[]; author?: string; kind?: number }
  | { type: "addr-ref"; identifier: string; pubkey: string; kind: number; relays?: string[] }
  | { type: "url"; url: string }
  | { type: "image"; url: string }
  | { type: "hashtag"; value: string };

const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|svg|avif|bmp)(\?.*)?$/i;

/** Bare nip19 entities (no nostr: prefix). Bech32 data charset. */
const BARE_BECH32_RE = /\b(npub1|nprofile1|note1|nevent1|naddr1)[02-9ac-hj-np-z]{20,}\b/g;

type Pointer = ProfilePointer | EventPointer | AddressPointer;

function isEventPointer(p: Pointer): p is EventPointer {
  return "id" in p;
}

function isAddressPointer(p: Pointer): p is AddressPointer {
  return "identifier" in p && "pubkey" in p && "kind" in p;
}

function isProfilePointer(p: Pointer): p is ProfilePointer {
  return "pubkey" in p && !("id" in p) && !("identifier" in p);
}

/** Drop unsafe attacker-controlled relay hints; undefined when none survive. */
function cleanRelays(relays?: string[]): string[] | undefined {
  const safe = relays?.filter((url) => isSafePeerRelayUrl(url));
  return safe && safe.length > 0 ? safe : undefined;
}

function segmentFromPointer(pointer: Pointer): ContentSegment | null {
  if (isAddressPointer(pointer)) {
    return {
      type: "addr-ref",
      identifier: pointer.identifier,
      pubkey: pointer.pubkey,
      kind: pointer.kind,
      relays: cleanRelays(pointer.relays),
    };
  }
  if (isEventPointer(pointer)) {
    return {
      type: "event-ref",
      id: pointer.id,
      relays: cleanRelays(pointer.relays),
      author: pointer.author,
      kind: pointer.kind,
    };
  }
  if (isProfilePointer(pointer)) {
    return { type: "mention", pubkey: pointer.pubkey, relays: cleanRelays(pointer.relays) };
  }
  return null;
}

function segmentFromBareEntity(entity: string): ContentSegment | null {
  try {
    const decoded = nip19.decode(entity);
    switch (decoded.type) {
      case "npub":
        return { type: "mention", pubkey: decoded.data };
      case "nprofile":
        return segmentFromPointer(decoded.data);
      case "note":
        return { type: "event-ref", id: decoded.data };
      case "nevent":
        return segmentFromPointer(decoded.data);
      case "naddr":
        return segmentFromPointer(decoded.data);
      default:
        return null;
    }
  } catch {
    return null; // not valid bech32 — stays text
  }
}

/** Split text segments on bare nip19 entities nip27 didn't catch. */
function extractBareEntities(segments: ContentSegment[]): ContentSegment[] {
  const result: ContentSegment[] = [];
  for (const seg of segments) {
    if (seg.type !== "text") {
      result.push(seg);
      continue;
    }
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    BARE_BECH32_RE.lastIndex = 0;
    while ((match = BARE_BECH32_RE.exec(seg.text)) !== null) {
      const entity = segmentFromBareEntity(match[0]);
      if (!entity) continue;
      if (match.index > lastIndex) {
        result.push({ type: "text", text: seg.text.slice(lastIndex, match.index) });
      }
      result.push(entity);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < seg.text.length) {
      result.push({ type: "text", text: seg.text.slice(lastIndex) });
    } else if (lastIndex === 0) {
      result.push(seg);
    }
  }
  return result;
}

function urlSegment(url: string): ContentSegment {
  if (IMAGE_EXTS.test(url)) {
    const safe = safeImageUri(url);
    if (safe) return { type: "image", url: safe };
  }
  return { type: "url", url };
}

/** Parse note/chat/DM content into typed segments (NIP-27 + bare bech32). */
export function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];

  for (const token of parse(content)) {
    switch (token.type) {
      case "text":
        if (token.text) segments.push({ type: "text", text: token.text });
        break;
      case "reference": {
        const seg = segmentFromPointer(token.pointer);
        if (seg) segments.push(seg);
        break;
      }
      case "hashtag":
        segments.push({ type: "hashtag", value: token.value });
        break;
      case "url":
      case "video":
      case "audio":
        // Video/audio/doc links stay tappable links on mobile (v1).
        segments.push(urlSegment(token.url));
        break;
      case "image":
        segments.push(urlSegment(token.url));
        break;
      case "emoji":
        segments.push({ type: "text", text: `:${token.shortcode}:` });
        break;
      default:
        // relay etc. — render as plain text.
        if ("url" in token && token.url) {
          segments.push({ type: "text", text: String(token.url) });
        }
    }
  }

  return extractBareEntities(segments);
}
