/**
 * Collapse a message body into a friendly one-line preview for conversation
 * lists, notifications, etc. Replaces `nostr:` references and media URLs — which
 * would otherwise show as an unreadable bech32 blob or a long URL — with short
 * human-readable labels.
 *
 * Pure + synchronous (no profile lookups), so it's safe to call from reducers.
 */

// bech32 payload is [a-z0-9]; over-matching is fine here since the token is
// whitespace-delimited and we only need a readable label.
const NOTE_REF_RE = /(?:nostr:)?n(?:event|ote|addr)1[a-z0-9]+/gi;
const PROFILE_REF_RE = /(?:nostr:)?n(?:profile|pub)1[a-z0-9]+/gi;
const IMAGE_URL_RE = /https?:\/\/\S+\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:\?\S*)?/gi;
const VIDEO_URL_RE = /https?:\/\/\S+\.(?:mp4|webm|mov|m4v|mkv|m3u8)(?:\?\S*)?/gi;
const AUDIO_URL_RE = /https?:\/\/\S+\.(?:mp3|wav|ogg|flac|m4a|opus|aac)(?:\?\S*)?/gi;

/** Replace noisy refs/URLs with labels and collapse whitespace. */
export function summarizeContent(content: string): string {
  return content
    .replace(NOTE_REF_RE, "📝 note")
    .replace(PROFILE_REF_RE, "@mention")
    .replace(IMAGE_URL_RE, "📷 photo")
    .replace(VIDEO_URL_RE, "🎥 video")
    .replace(AUDIO_URL_RE, "🎵 audio")
    .replace(/\s+/g, " ")
    .trim();
}
