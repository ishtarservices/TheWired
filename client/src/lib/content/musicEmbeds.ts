/**
 * External music links a space can put on its shelf — YouTube, SoundCloud,
 * Bandcamp, Spotify, Apple Music. Shared wire rules with soot
 * (`lib/links/musicEmbeds.ts`): the `canonicalUrl` is the dedupe key both
 * clients write into a shelf post's `["r", …]` tag, so two posts of the same
 * thing collapse to one row on every device. Pure. Only YouTube has a
 * deterministic thumbnail; the rest render as a provider card.
 */

export type MusicProvider = "youtube" | "soundcloud" | "bandcamp" | "spotify" | "applemusic";

export interface ExternalMediaItem {
  provider: MusicProvider;
  /** The url as posted. */
  url: string;
  /** Normalised https url — the dedupe key across posts of the same thing. */
  canonicalUrl: string;
  /** Provider-scoped id (video id, `user/slug`, `sub/album/slug`, …). */
  id: string;
  /** track | album | playlist | video | set | song — provider vocabulary. */
  subtype?: string;
  title?: string;
  thumb?: string;
}

const PROVIDER_LABELS: Record<MusicProvider, string> = {
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  spotify: "Spotify",
  applemusic: "Apple Music",
};

export function providerLabel(provider: MusicProvider): string {
  return PROVIDER_LABELS[provider];
}

/** Shelf key for an external item — namespaced so it can never collide with
 *  an addressable id. */
export function externalMediaKey(canonicalUrl: string): string {
  return `r:${canonicalUrl}`;
}

const YT_VIDEO_RE =
  /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const YT_PLAYLIST_RE = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/playlist\?(?:[^#]*&)?list=([\w-]+)/i;
const SC_RE = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([\w-]+)\/(?:(sets)\/)?([\w-]+)/i;
const SC_RESERVED = new Set([
  "discover", "search", "stream", "you", "upload", "charts", "pages", "people",
  "tags", "terms-of-use", "jobs", "settings", "notifications", "messages",
]);
const BC_RE = /^https?:\/\/([\w-]+)\.bandcamp\.com\/(track|album)\/([\w-]+)/i;
const SPOTIFY_RE =
  /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist)\/([A-Za-z0-9]+)/i;
const APPLE_RE =
  /^https?:\/\/music\.apple\.com\/([a-z]{2})\/(album|song|playlist)\/([^/?#]+)\/([\w.-]+)(?:\?(?:[^#]*&)?i=(\d+))?/i;

/** Match one url against the music providers. Null for anything else —
 *  including provider pages that aren't a piece of music (a channel, a
 *  search). */
export function matchMusicEmbed(url: string): ExternalMediaItem | null {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let m = YT_VIDEO_RE.exec(trimmed);
  if (m) {
    const id = m[1];
    return {
      provider: "youtube",
      url: trimmed,
      canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      id,
      subtype: /^https?:\/\/music\.youtube\.com/i.test(trimmed) ? "song" : "video",
      thumb: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    };
  }
  m = YT_PLAYLIST_RE.exec(trimmed);
  if (m) {
    const id = m[1];
    return {
      provider: "youtube",
      url: trimmed,
      canonicalUrl: `https://www.youtube.com/playlist?list=${id}`,
      id,
      subtype: "playlist",
    };
  }
  m = SC_RE.exec(trimmed);
  if (m) {
    const user = m[1].toLowerCase();
    if (SC_RESERVED.has(user)) return null;
    const isSet = !!m[2];
    const slug = m[3].toLowerCase();
    const path = isSet ? `${user}/sets/${slug}` : `${user}/${slug}`;
    return {
      provider: "soundcloud",
      url: trimmed,
      canonicalUrl: `https://soundcloud.com/${path}`,
      id: path,
      subtype: isSet ? "set" : "track",
    };
  }
  m = BC_RE.exec(trimmed);
  if (m) {
    const sub = m[1].toLowerCase();
    const type = m[2].toLowerCase();
    const slug = m[3].toLowerCase();
    return {
      provider: "bandcamp",
      url: trimmed,
      canonicalUrl: `https://${sub}.bandcamp.com/${type}/${slug}`,
      id: `${sub}/${type}/${slug}`,
      subtype: type,
    };
  }
  m = SPOTIFY_RE.exec(trimmed);
  if (m) {
    const type = m[1].toLowerCase();
    const id = m[2];
    return {
      provider: "spotify",
      url: trimmed,
      canonicalUrl: `https://open.spotify.com/${type}/${id}`,
      id,
      subtype: type,
    };
  }
  m = APPLE_RE.exec(trimmed);
  if (m) {
    const storefront = m[1].toLowerCase();
    const type = m[2].toLowerCase();
    const slug = m[3];
    const id = m[4];
    const songId = m[5];
    const base = `https://music.apple.com/${storefront}/${type}/${slug}/${id}`;
    return {
      provider: "applemusic",
      url: trimmed,
      canonicalUrl: songId ? `${base}?i=${songId}` : base,
      id: songId ? `${storefront}/${type}/${id}/${songId}` : `${storefront}/${type}/${id}`,
      subtype: songId ? "song" : type,
    };
  }
  return null;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

/** First provider link in free text, if any. */
export function findMusicEmbedInText(text: string): ExternalMediaItem | null {
  for (const m of text.matchAll(URL_RE)) {
    const hit = matchMusicEmbed(m[0]);
    if (hit) return hit;
  }
  return null;
}
