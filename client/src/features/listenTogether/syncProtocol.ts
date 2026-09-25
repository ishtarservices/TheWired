// Listen Together wire format. The contract (types, constants, message
// semantics) lives in @ishtarservices/shared-types listenTogether.ts and the
// strict decoder in @ishtarservices/core — shared with the mobile app, so
// both clients accept exactly the same packets. This module keeps the
// desktop-side names the feature code uses.

import {
  LT_TOPIC,
  LT_DJ_ONLY_TYPES,
  LT_MAX_LATENCY_MS,
  type LtType,
  type LtTrackMeta,
  type LtStartData,
  type LtPlayData,
  type LtSuggestData,
} from "@ishtarservices/shared-types";
import { parseLt, ltAnchorTime } from "@ishtarservices/core";

// ── Message types ──────────────────────────────────────────────────

export type LTMessageType = LtType;

export interface LTMessage {
  type: LTMessageType;
  ts: number; // sender's Date.now() for latency compensation
  dj: string; // DJ pubkey (self-reported — authority comes from the sender identity)
  data: Record<string, unknown>;
}

// ── Payload shapes ─────────────────────────────────────────────────

export type TrackMeta = LtTrackMeta;
export type LTStartPayload = LtStartData;
export type LTPlayPayload = LtPlayData;
export type LTSuggestPayload = LtSuggestData;

export interface LTPausePayload {
  position: number;
}

export interface LTSeekPayload {
  position: number;
}

export interface LTQueuePayload {
  queue: string[];
}

export interface LTTransferDJPayload {
  targetPubkey: string;
}

export interface LTRequestDJPayload {
  requesterPubkey: string;
}

export interface LTVoteSkipPayload {
  voterPubkey: string;
}

export interface LTReactionPayload {
  emoji: string;
  senderPubkey: string;
}

export interface LTJoinPayload {
  pubkey: string;
}

export interface LTLeavePayload {
  pubkey: string;
}

/**
 * Message types only the current DJ may send. Anything else is a listener
 * message (reaction, vote, join/leave, DJ request, suggestion).
 */
export const DJ_ONLY_TYPES: ReadonlySet<LTMessageType> = new Set(LT_DJ_ONLY_TYPES);

/** A remote clock can be skewed — never compensate more than this. */
export const MAX_LATENCY_MS = LT_MAX_LATENCY_MS;

/**
 * Local time at which a DJ's `position` in a message stamped `ts` (DJ clock)
 * was valid: the one-way latency, clamped against clock skew.
 */
export function anchorTime(ts: number, now = Date.now()): number {
  return ltAnchorTime(ts, now);
}

// ── Encode / decode ────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const LISTEN_TOGETHER_TOPIC = LT_TOPIC;

export function encodeLTMessage(msg: LTMessage): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

/** Strict: null for anything malformed or unknown (see core `parseLt`). */
export function decodeLTMessage(data: Uint8Array): LTMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(data));
  } catch {
    return null;
  }
  const env = parseLt(raw);
  if (!env) return null;
  return {
    type: env.type,
    ts: env.ts,
    dj: env.dj,
    data: env.data as unknown as Record<string, unknown>,
  };
}

// ── Factory helpers ────────────────────────────────────────────────

export function createLTMessage(
  type: LTMessageType,
  djPubkey: string,
  data: Record<string, unknown>,
): LTMessage {
  return { type, ts: Date.now(), dj: djPubkey, data };
}
