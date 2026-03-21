import type { ImetaVariant } from "@/types/media";

// ── Message types ──────────────────────────────────────────────────

export type LTMessageType =
  | "lt:start"
  | "lt:end"
  | "lt:play"
  | "lt:pause"
  | "lt:seek"
  | "lt:queue"
  | "lt:next"
  | "lt:prev"
  | "lt:transfer_dj"
  | "lt:request_dj"
  | "lt:vote_skip"
  | "lt:reaction"
  | "lt:join"
  | "lt:leave";

export interface LTMessage {
  type: LTMessageType;
  ts: number; // DJ's Date.now() for latency compensation
  dj: string; // DJ pubkey
  data: Record<string, unknown>;
}

// ── Payload shapes ─────────────────────────────────────────────────

export interface TrackMeta {
  title: string;
  artist: string;
  imageUrl?: string;
  variants: ImetaVariant[];
}

export interface LTStartPayload {
  djPubkey: string;
  trackId: string | null;
  queue: string[];
  queueIndex: number;
  position: number;
  isPlaying: boolean;
  trackMeta: TrackMeta | null;
}

export interface LTPlayPayload {
  trackId: string;
  position: number;
  queue: string[];
  queueIndex: number;
  trackMeta: TrackMeta;
}

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

// ── Encode / decode ────────────────────────────────────────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const LISTEN_TOGETHER_TOPIC = "listen-together";

export function encodeLTMessage(msg: LTMessage): Uint8Array {
  return encoder.encode(JSON.stringify(msg));
}

export function decodeLTMessage(data: Uint8Array): LTMessage | null {
  try {
    const parsed = JSON.parse(decoder.decode(data));
    if (parsed && typeof parsed.type === "string" && parsed.type.startsWith("lt:")) {
      return parsed as LTMessage;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Factory helpers ────────────────────────────────────────────────

export function createLTMessage(
  type: LTMessageType,
  djPubkey: string,
  data: Record<string, unknown>,
): LTMessage {
  return { type, ts: Date.now(), dj: djPubkey, data };
}
