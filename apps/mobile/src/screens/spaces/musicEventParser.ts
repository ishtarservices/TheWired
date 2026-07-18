// Music-channel parsing: kind 31683 (track) + 33123 (album) → list rows and
// (as of the mobile player) playable items. Tag names mirror the desktop
// trackParser/albumParser: title/artist/image/thumb, album `a` refs, audio in
// `imeta` (url/m/x/size), roled `p` artist tags, and the visibility tags that
// gate sharing (public / space `h` / private `visibility`).

import type { NostrEvent } from "@thewired/shared-types";

export type MusicVisibility = "public" | "space" | "private";

/** One imeta variant (a single audio rendition). */
export interface MusicVariant {
  url: string;
  mime?: string;
  /** sha256 from imeta `x` — maps to the backend HLS ladder in P2. */
  hash?: string;
  bitrate?: number;
  durationSec?: number;
}

export interface MusicItem {
  id: string;
  event: NostrEvent;
  kind: "track" | "album";
  /** Stable catalog key `${kind}:${pubkey}:${d}` — dedups a track across
   *  space feed / browse / embed and is stashed in each RNTP `Track.id`. */
  addressableId: string;
  title: string;
  /** Artist display string (tag, else the author pubkey renders upstream). */
  artist: string | null;
  /** https artwork URL, if any. */
  artwork: string | null;
  /** Best playable audio URL (tracks only; null for albums / unplayable). */
  audioUrl: string | null;
  /** Mime of the selected variant, if known. */
  mime?: string;
  /** sha256 of the selected variant (imeta `x`) — HLS discovery in P2. */
  hash?: string;
  /** Sharing/exclusivity: public, space-exclusive (`h`), or private (NIP-44). */
  visibility: MusicVisibility;
  /** Owning space id, when space-scoped (`h` tag). */
  spaceId?: string;
  /** Curated channel id, when tagged (`channel`). */
  channelId?: string;
  /** Zap-relevant pubkeys (roled `p` artist + featured), for artist tips (P3). */
  artistPubkeys: string[];
  /** Parent album ref `33123:pubkey:d` (tracks only). */
  albumRef?: string;
  /** Track count for albums (from 31683 `a` refs). */
  trackCount?: number;
  /** Duration in seconds for tracks, when tagged or in imeta. */
  durationSec?: number;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

function httpsOrNull(value: string | undefined): string | null {
  return value && /^https:\/\//i.test(value) ? value : null;
}

/** Addressable id from an event's kind + author + `d` tag. */
export function addressableId(event: NostrEvent): string {
  return `${event.kind}:${event.pubkey}:${tagValue(event, "d") ?? ""}`;
}

/** Parse imeta tags into variants (mirrors desktop imetaParser), with the
 *  raw-scan fallback for events whose imeta omits the mime type. */
export function parseVariants(event: NostrEvent): MusicVariant[] {
  const variants: MusicVariant[] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "imeta") continue;
    const v: MusicVariant = { url: "" };
    for (let i = 1; i < tag.length; i++) {
      const entry = tag[i];
      const sp = entry.indexOf(" ");
      if (sp === -1) continue;
      const key = entry.slice(0, sp);
      const val = entry.slice(sp + 1);
      if (key === "url") v.url = val;
      else if (key === "m") v.mime = val;
      else if (key === "x") v.hash = val;
      else if (key === "size") continue;
      else if (key === "bitrate") v.bitrate = Number.parseInt(val, 10) || undefined;
      else if (key === "duration") v.durationSec = Number.parseFloat(val) || undefined;
    }
    if (v.url) variants.push(v);
  }
  return variants;
}

/** Pick the best audio variant: highest-bitrate `audio/*`, else the first. */
export function selectAudioVariant(variants: MusicVariant[]): MusicVariant | undefined {
  const audio = variants.filter((v) => v.mime?.startsWith("audio/"));
  const pool = audio.length > 0 ? audio : variants;
  if (pool.length === 0) return undefined;
  return pool.reduce((best, v) => ((v.bitrate ?? 0) > (best.bitrate ?? 0) ? v : best));
}

/** Visibility from event tags — `h` ⇒ space-exclusive, `visibility` ⇒ private. */
export function parseVisibility(event: NostrEvent): MusicVisibility {
  if (event.tags.some((t) => t[0] === "h")) return "space";
  const vis = tagValue(event, "visibility");
  if (vis === "private" || vis === "unlisted") return "private";
  return "public";
}

/** Zap-relevant pubkeys: roled `p` artist + featured (legacy: non-author p-tags
 *  treated as featured). Order = artists then featured; deduped. */
export function parseArtistPubkeys(event: NostrEvent): string[] {
  const pTags = event.tags.filter((t) => t[0] === "p" && t[1]);
  const hasRoles = pTags.some((t) => t[3]);
  const artists = hasRoles ? pTags.filter((t) => t[3] === "artist").map((t) => t[1]) : [];
  const featured = hasRoles
    ? pTags.filter((t) => t[3] === "featured").map((t) => t[1])
    : pTags.filter((t) => t[1] !== event.pubkey).map((t) => t[1]);
  return [...new Set([...artists, ...featured])];
}

export function parseMusicEvent(event: NostrEvent): MusicItem | null {
  if (event.kind !== 31683 && event.kind !== 33123) return null;

  const title = tagValue(event, "title")?.trim() || "Untitled";
  const artwork = httpsOrNull(tagValue(event, "image") ?? tagValue(event, "thumb"));
  const artist = tagValue(event, "artist")?.trim() || null;
  const visibility = parseVisibility(event);
  const spaceId = tagValue(event, "h");
  const channelId = tagValue(event, "channel");
  const artistPubkeys = parseArtistPubkeys(event);

  const base = {
    id: event.id,
    event,
    addressableId: addressableId(event),
    title,
    artist,
    artwork,
    visibility,
    artistPubkeys,
    ...(spaceId ? { spaceId } : {}),
    ...(channelId ? { channelId } : {}),
  };

  if (event.kind === 33123) {
    const trackCount = event.tags.filter(
      (t) => t[0] === "a" && t[1]?.startsWith("31683:"),
    ).length;
    // Albums are collections, not directly playable.
    return { ...base, kind: "album", audioUrl: null, trackCount };
  }

  const variant = selectAudioVariant(parseVariants(event));
  const albumRef = event.tags.find((t) => t[0] === "a" && t[1]?.startsWith("33123:"))?.[1];

  const durationTag = Number.parseFloat(tagValue(event, "duration") ?? "");
  const durationSec =
    Number.isFinite(durationTag) && durationTag > 0
      ? Math.round(durationTag)
      : variant?.durationSec && variant.durationSec > 0
        ? Math.round(variant.durationSec)
        : undefined;

  return {
    ...base,
    kind: "track",
    audioUrl: variant?.url ?? null,
    ...(variant?.mime ? { mime: variant.mime } : {}),
    ...(variant?.hash ? { hash: variant.hash } : {}),
    ...(albumRef ? { albumRef } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
  };
}

export function parseMusicEvents(events: NostrEvent[]): MusicItem[] {
  const out: MusicItem[] = [];
  for (const event of events) {
    const item = parseMusicEvent(event);
    if (item) out.push(item);
  }
  return out;
}

/** A track is playable iff we resolved an audio URL and it isn't NIP-44 private. */
export function isPlayable(item: MusicItem): boolean {
  return item.kind === "track" && item.visibility !== "private" && !!item.audioUrl;
}

export function formatTrackDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
