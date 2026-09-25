// Listen Together wire helpers (types + contract: shared-types listenTogether.ts).
//
//  - `parseLt` is the strict decoder both clients run on every incoming packet:
//    a packet that doesn't carry what its type promises is dropped, never
//    half-applied, and every field is rebuilt (unknown keys are shed, urls are
//    http(s)-only). Takes already-parsed JSON so it stays platform-neutral.
//  - `capLtQueue` keeps an outgoing queue within LT_MAX_QUEUE.
//  - `ltAnchorTime` turns a sender timestamp into the local time its position
//    was valid at.
//  - Nothing here touches a socket or decides authority — receivers check the
//    sender's participant identity against the current DJ themselves.

import type {
  LtEnvelope,
  LtMessage,
  LtTrackMeta,
  LtVariant,
} from "@ishtarservices/shared-types";
import { LT_MAX_LATENCY_MS, LT_MAX_QUEUE } from "@ishtarservices/shared-types";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isHttpUrl = (v: unknown): v is string => isStr(v) && /^https?:\/\//i.test(v);

/** A 64-char lowercase hex pubkey. */
export function isLtPubkey(v: unknown): v is string {
  return isStr(v) && /^[0-9a-f]{64}$/.test(v);
}

/** Addressable id of a track: `31683:<pubkey>:<d>`. */
export function isLtTrackId(v: unknown): v is string {
  return isStr(v) && /^31683:[0-9a-f]{64}:.*$/s.test(v);
}

const isQueue = (v: unknown): v is string[] => Array.isArray(v) && v.every(isLtTrackId);

function parseVariant(v: unknown): LtVariant | null {
  if (!isObj(v) || !isHttpUrl(v.url)) return null;
  return {
    url: v.url,
    mimeType: isStr(v.mimeType) ? v.mimeType : "",
    ...(isStr(v.hash) ? { hash: v.hash } : {}),
    ...(isNum(v.size) ? { size: v.size } : {}),
    ...(isNum(v.bitrate) ? { bitrate: v.bitrate } : {}),
    ...(isNum(v.duration) ? { duration: v.duration } : {}),
  };
}

/** A track hint from a peer, normalized; null when it isn't one. */
export function parseLtTrackMeta(v: unknown): LtTrackMeta | null {
  if (!isObj(v) || !Array.isArray(v.variants)) return null;
  const variants = v.variants.map(parseVariant).filter((x): x is LtVariant => x !== null);
  return {
    title: isStr(v.title) && v.title.trim() ? v.title : "Untitled",
    artist: isStr(v.artist) ? v.artist : "",
    ...(isHttpUrl(v.imageUrl) ? { imageUrl: v.imageUrl } : {}),
    variants,
    ...(v.visibility === "public" || v.visibility === "space" || v.visibility === "private"
      ? { visibility: v.visibility }
      : {}),
  };
}

const parsePosition = (v: unknown): number | null => (isNum(v) ? Math.max(0, v) : null);
const parseIndex = (v: unknown): number => (isNum(v) ? Math.max(0, Math.trunc(v)) : 0);

function parseData(type: string, d: Record<string, unknown>): LtMessage | null {
  switch (type) {
    case "lt:start": {
      const position = parsePosition(d.position);
      const trackMeta = d.trackMeta == null ? null : parseLtTrackMeta(d.trackMeta);
      const trackId = d.trackId == null ? null : isLtTrackId(d.trackId) ? d.trackId : undefined;
      if (!isLtPubkey(d.djPubkey) || trackId === undefined || !isQueue(d.queue) || position === null) {
        return null;
      }
      return {
        type,
        data: {
          djPubkey: d.djPubkey,
          trackId,
          queue: d.queue,
          queueIndex: parseIndex(d.queueIndex),
          position,
          isPlaying: d.isPlaying === true,
          trackMeta,
        },
      };
    }
    case "lt:play": {
      const position = parsePosition(d.position);
      const trackMeta = parseLtTrackMeta(d.trackMeta);
      if (!isLtTrackId(d.trackId) || position === null || !trackMeta || !isQueue(d.queue)) return null;
      return {
        type,
        data: {
          trackId: d.trackId,
          position,
          queue: d.queue,
          queueIndex: parseIndex(d.queueIndex),
          trackMeta,
        },
      };
    }
    case "lt:pause":
    case "lt:seek": {
      const position = parsePosition(d.position);
      return position === null ? null : { type, data: { position } };
    }
    case "lt:queue":
      return isQueue(d.queue) ? { type, data: { queue: d.queue } } : null;
    case "lt:end":
    case "lt:next":
    case "lt:prev":
      return { type, data: {} };
    case "lt:transfer_dj":
      return isLtPubkey(d.targetPubkey) ? { type, data: { targetPubkey: d.targetPubkey } } : null;
    case "lt:request_dj":
      return isLtPubkey(d.requesterPubkey)
        ? { type, data: { requesterPubkey: d.requesterPubkey } }
        : null;
    case "lt:vote_skip":
      return isLtPubkey(d.voterPubkey) ? { type, data: { voterPubkey: d.voterPubkey } } : null;
    case "lt:reaction":
      return isStr(d.emoji) && d.emoji.length > 0 && d.emoji.length <= 16 && isLtPubkey(d.senderPubkey)
        ? { type, data: { emoji: d.emoji, senderPubkey: d.senderPubkey } }
        : null;
    case "lt:join":
    case "lt:leave":
      return isLtPubkey(d.pubkey) ? { type, data: { pubkey: d.pubkey } } : null;
    case "lt:suggest": {
      const trackMeta = parseLtTrackMeta(d.trackMeta);
      return isLtTrackId(d.trackId) && trackMeta
        ? { type, data: { trackId: d.trackId, trackMeta } }
        : null;
    }
    default:
      // Unknown lt:* — a newer client. Ignore.
      return null;
  }
}

/**
 * Strict decode of one parsed packet body; null for anything malformed,
 * foreign (not `lt:*`), or of an unknown type.
 */
export function parseLt(raw: unknown): LtEnvelope | null {
  if (!isObj(raw) || !isStr(raw.type) || !raw.type.startsWith("lt:")) return null;
  const msg = parseData(raw.type, isObj(raw.data) ? raw.data : {});
  if (!msg) return null;
  return {
    type: msg.type,
    data: msg.data,
    ts: isNum(raw.ts) ? raw.ts : 0,
    dj: isStr(raw.dj) ? raw.dj : "",
  };
}

/**
 * At most LT_MAX_QUEUE ids around `queueIndex` (the current track stays in),
 * with the index rebased onto the window.
 */
export function capLtQueue(
  queue: readonly string[],
  queueIndex: number,
): { queue: string[]; queueIndex: number } {
  if (queue.length <= LT_MAX_QUEUE) return { queue: [...queue], queueIndex };
  const start = Math.max(0, Math.min(queueIndex, queue.length - LT_MAX_QUEUE));
  return {
    queue: queue.slice(start, start + LT_MAX_QUEUE),
    queueIndex: queueIndex - start,
  };
}

/**
 * Local time at which a position stamped `ts` (sender clock, ms) was valid:
 * the one-way latency, clamped to 0…LT_MAX_LATENCY_MS against clock skew.
 */
export function ltAnchorTime(ts: number, now: number): number {
  const latency = Number.isFinite(ts) ? now - ts : 0;
  return now - Math.min(Math.max(latency, 0), LT_MAX_LATENCY_MS);
}
