export type EmbedPlatform = "youtube" | "twitter" | "spotify" | "tiktok" | "instagram";

export interface EmbedMatch {
  platform: EmbedPlatform;
  id: string;
  originalUrl: string;
  embedUrl: string | null; // null = link card only (no iframe)
  /** Subtype for Spotify (track, album, playlist) */
  subtype?: string;
}

interface EmbedPattern {
  platform: EmbedPlatform;
  pattern: RegExp;
  extract: (match: RegExpMatchArray, url: string) => EmbedMatch | null;
}

const patterns: EmbedPattern[] = [
  // YouTube: watch, shorts, youtu.be
  {
    platform: "youtube",
    pattern: /(?:youtube\.com\/(?:watch\?.*v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    extract: (match, url) => ({
      platform: "youtube",
      id: match[1],
      originalUrl: url,
      embedUrl: `https://www.youtube.com/embed/${match[1]}`,
    }),
  },
  // Twitter / X
  {
    platform: "twitter",
    pattern: /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
    extract: (match, url) => ({
      platform: "twitter",
      id: match[1],
      originalUrl: url,
      embedUrl: `https://platform.twitter.com/embed/Tweet.html?id=${match[1]}&theme=dark`,
    }),
  },
  // Spotify
  {
    platform: "spotify",
    pattern: /open\.spotify\.com\/(track|album|playlist)\/([a-zA-Z0-9]+)/,
    extract: (match, url) => ({
      platform: "spotify",
      id: match[2],
      subtype: match[1],
      originalUrl: url,
      embedUrl: `https://open.spotify.com/embed/${match[1]}/${match[2]}?theme=0`,
    }),
  },
  // TikTok
  {
    platform: "tiktok",
    pattern: /tiktok\.com\/@[^/]+\/video\/(\d+)/,
    extract: (match, url) => ({
      platform: "tiktok",
      id: match[1],
      originalUrl: url,
      embedUrl: `https://www.tiktok.com/embed/v2/${match[1]}`,
    }),
  },
  // Instagram — no iframe (blocked by Instagram), link card only
  {
    platform: "instagram",
    pattern: /instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/,
    extract: (match, url) => ({
      platform: "instagram",
      id: match[1],
      originalUrl: url,
      embedUrl: null,
    }),
  },
];

/** Match a URL against known embed platforms. Returns null if no match. */
export function matchEmbed(url: string): EmbedMatch | null {
  for (const { pattern, extract } of patterns) {
    const match = url.match(pattern);
    if (match) {
      return extract(match, url);
    }
  }
  return null;
}
