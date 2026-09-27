// Listen Together wire contract — shared TYPES and constants for shared music
// in voice rooms / calls. One participant is the DJ; everyone streams the same
// kind:31683 track in their own player, and only CONTROL state crosses the
// room: reliable LiveKit data packets on the LT_TOPIC topic, UTF-8 JSON
// envelopes. No audio is published.
//
//   {"type":"lt:<x>","ts":<sender ms>,"dj":"<dj pubkey hex>","data":{…}}
//
// Consumed by the desktop client and the mobile app. Keep this file free of
// runtime logic; the strict decoder lives in @ishtarservices/core
// (`decodeLt`).
//
// Authority: receivers take the acting pubkey from the sender's LiveKit
// participant identity (bound to the pubkey by the token server), never from
// the self-reported envelope `dj` or payload pubkeys. LT_DJ_ONLY_TYPES are
// honored only from the current DJ.

/** LiveKit data-packet topic. */
export const LT_TOPIC = "listen-together";

/**
 * Most queue ids a sender puts in one packet (~10 KB). LiveKit wants reliable
 * packets well under 15 KiB.
 */
export const LT_MAX_QUEUE = 100;

/** Latency compensation (now − ts) is clamped to 0…this, against clock skew. */
export const LT_MAX_LATENCY_MS = 5_000;

/** Drift (seconds) below which a sync message leaves playback alone. */
export const LT_SYNC_TOLERANCE_S = 1;

/** Longest a goodbye (lt:end / lt:leave) may hold up leaving the room. */
export const LT_GOODBYE_TIMEOUT_MS = 500;

/** The reaction palette both clients offer. */
export const LT_REACTIONS = ["🔥", "❤️", "😍", "🙌", "🎶", "💥"] as const;

/** One media source for a track — desktop's ImetaVariant subset. */
export interface LtVariant {
  /** http(s) only. */
  url: string;
  mimeType: string;
  /** Blob sha256; drives the HLS variants lookup. */
  hash?: string;
  size?: number;
  bitrate?: number;
  duration?: number;
}

/**
 * Who may stream the track: an `h` tag → "space"; `visibility` private or
 * unlisted → "private"; anything else → "public". Optional on the wire (older
 * senders omit it); a listener without the event then probes
 * `/music/access`. "space" and "private" always need a `?tk=` grant.
 */
export type LtVisibility = "public" | "space" | "private";

/** Enough to play a track the listener has never seen the event for. */
export interface LtTrackMeta {
  title: string;
  artist: string;
  imageUrl?: string;
  variants: LtVariant[];
  visibility?: LtVisibility;
}

export interface LtStartData {
  djPubkey: string;
  trackId: string | null;
  queue: string[];
  queueIndex: number;
  position: number;
  isPlaying: boolean;
  trackMeta: LtTrackMeta | null;
}

export interface LtPlayData {
  trackId: string;
  position: number;
  queue: string[];
  queueIndex: number;
  trackMeta: LtTrackMeta;
}

export interface LtSuggestData {
  trackId: string;
  trackMeta: LtTrackMeta;
}

/**
 * Every message, by type. Senders always emit every field; decoders drop a
 * packet that doesn't carry what its type promises.
 *
 * - lt:start      — DJ: session (re)announce. Re-sent on every participant
 *                   join (the only catch-up path); a receiver that dismissed
 *                   this DJ's session keeps it dismissed.
 * - lt:end        — DJ: session over. Sent before leaving the room too.
 * - lt:play       — DJ: play `trackId` from `position`. Same trackId as the
 *                   current one = a sync (seek only past the tolerance), not
 *                   a reload.
 * - lt:pause      — DJ: pause at `position` (also: queue ran out).
 * - lt:seek       — DJ: seek; also a ~2.5 s heartbeat while playing.
 * - lt:queue      — DJ: full upcoming queue replaced.
 * - lt:next/prev  — DJ: always followed by an lt:play carrying the track.
 * - lt:transfer_dj— DJ: `targetPubkey` is the new DJ.
 * - lt:request_dj — listener asks for the DJ role (honored in DMs only).
 * - lt:vote_skip  — listener vote; DJ skips at ceil(listeners / 2) in spaces.
 * - lt:reaction   — anyone; `emoji` ≤ 16 UTF-16 units.
 * - lt:join/leave — listener joined / left the session (leave is sent before
 *                   leaving the room too).
 * - lt:suggest    — listener suggests a track; only the DJ acts on it (accept
 *                   = append to the queue + lt:queue). Others ignore it.
 */
export type LtMessage =
  | { type: "lt:start"; data: LtStartData }
  | { type: "lt:end"; data: Record<string, never> }
  | { type: "lt:play"; data: LtPlayData }
  | { type: "lt:pause"; data: { position: number } }
  | { type: "lt:seek"; data: { position: number } }
  | { type: "lt:queue"; data: { queue: string[] } }
  | { type: "lt:next"; data: Record<string, never> }
  | { type: "lt:prev"; data: Record<string, never> }
  | { type: "lt:transfer_dj"; data: { targetPubkey: string } }
  | { type: "lt:request_dj"; data: { requesterPubkey: string } }
  | { type: "lt:vote_skip"; data: { voterPubkey: string } }
  | { type: "lt:reaction"; data: { emoji: string; senderPubkey: string } }
  | { type: "lt:join"; data: { pubkey: string } }
  | { type: "lt:leave"; data: { pubkey: string } }
  | { type: "lt:suggest"; data: LtSuggestData };

export type LtType = LtMessage["type"];

export interface LtEnvelope<M extends LtMessage = LtMessage> {
  type: M["type"];
  /** Sender's clock, ms — latency compensation on play/seek. */
  ts: number;
  /** The current DJ's pubkey (self-reported — never trusted for authority). */
  dj: string;
  data: M["data"];
}

/** Types only the current DJ may send. */
export const LT_DJ_ONLY_TYPES: readonly LtType[] = [
  "lt:start",
  "lt:end",
  "lt:play",
  "lt:pause",
  "lt:seek",
  "lt:queue",
  "lt:next",
  "lt:prev",
  "lt:transfer_dj",
];
