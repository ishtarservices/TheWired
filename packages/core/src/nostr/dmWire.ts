// The DM wire format, both directions (docs/DM_WIRE_CONTRACT.md §2–§5).
//
//  - `parseDMWire` turns an unwrapped rumor into one discriminated union the
//    UI layers switch on. It reads the spec form (kind 15 files, kind 7
//    reactions, `e` replies) AND the legacy form both our clients wrote before
//    wire_version 1 (`type=dm_reaction` rumors, `q` reply anchors), so either
//    client can ship ahead of the other.
//  - The `*RumorTags` builders produce the extra tags for `buildRumor`; they
//    never include the recipient `p` tag (buildRumor / buildGroupRumor add it).
//  - Nothing here signs, encrypts or touches a socket.

import type {
  DMControlType,
  DMFileMeta,
  DMReceiptStatus,
} from "@ishtarservices/shared-types";
import { DM_EXPIRATION_SECONDS, DM_CONTROL_TYPES } from "@ishtarservices/shared-types";
import {
  KIND_DM_MESSAGE,
  KIND_DM_FILE,
  KIND_REACTION,
  KIND_DM_TYPING,
  KIND_DM_RECEIPT,
} from "../kinds";
import type { UnwrappedDM } from "../crypto/giftWrap";
import { participantsOf, roomKeyFromParticipants } from "../crypto/nip17Room";
import { DM_FILE_ALGORITHM } from "../crypto/fileCrypto";

const HEX64_RE = /^[0-9a-f]{64}$/i;

// ─── Parsed shape ────────────────────────────────────────────────────

export interface DMWireBase {
  sender: string;
  wrapId: string;
  rumorId: string;
  /** Rumor created_at (the real send time). */
  createdAt: number;
  /** Peer pubkey for 1:1, room id for rooms. */
  conversationId: string;
  /** sender ∪ p tags, de-duplicated. */
  participants: string[];
  isRoom: boolean;
  subject?: string;
  expiration?: number;
  /** true when the message used a pre-contract shape (typed reaction, q reply). */
  legacy: boolean;
  /** The raw rumor tags, for anything not modelled here (NIP-30 emoji…). */
  tags: string[][];
}

export type DMWireEvent =
  | (DMWireBase & {
      type: "text";
      content: string;
      /** Rumor id of the message this replies to (`e`, or legacy `q`). */
      replyTo?: string;
      /** Rumor id quoted in the content (`q` alongside an `e`). */
      quote?: string;
      emojiTags: string[][];
    })
  | (DMWireBase & { type: "file"; file: DMFileMeta; replyTo?: string })
  | (DMWireBase & { type: "reaction"; targetRumorId: string; emoji: string; emojiTags: string[][] })
  | (DMWireBase & { type: "reaction_remove"; targetRumorId: string; emoji: string })
  | (DMWireBase & { type: "edit"; targetRumorId: string; content: string })
  | (DMWireBase & { type: "delete"; targetRumorId: string })
  | (DMWireBase & {
      type: "friend_request" | "friend_request_accept" | "friend_request_remove";
      content: string;
    })
  | (DMWireBase & { type: "call_invite" | "call_decline" | "call_missed"; content: string })
  | (DMWireBase & { type: "typing" })
  | (DMWireBase & { type: "receipt"; status: DMReceiptStatus; rumorIds: string[] })
  | (DMWireBase & { type: "unknown"; reason: string });

export type DMWireType = DMWireEvent["type"];

// ─── Helpers ─────────────────────────────────────────────────────────

function tagValues(tags: string[][], name: string): string[] {
  return tags.filter((t) => t[0] === name && typeof t[1] === "string").map((t) => t[1]);
}
function tagValue(tags: string[][], name: string): string | undefined {
  return tagValues(tags, name)[0];
}
function lastTagValue(tags: string[][], name: string): string | undefined {
  const vs = tagValues(tags, name);
  return vs[vs.length - 1];
}

/**
 * The conversation a rumor belongs to, from the receiver's point of view:
 * the explicit `g` room id, else the sorted participant key for 3+
 * participants, else the peer's pubkey (1:1; a note-to-self resolves to
 * my own pubkey).
 */
export function conversationIdOf(
  dm: Pick<UnwrappedDM, "sender" | "tags">,
  myPubkey: string,
): { conversationId: string; participants: string[]; isRoom: boolean } {
  const participants = participantsOf(dm);
  const g = tagValue(dm.tags, "g");
  if (g) return { conversationId: g, participants, isRoom: true };
  if (participants.length >= 3) {
    return { conversationId: roomKeyFromParticipants(participants), participants, isRoom: true };
  }
  const peer = participants.find((p) => p !== myPubkey) ?? myPubkey;
  return { conversationId: peer, participants, isRoom: false };
}

function isControlType(v: string | undefined): v is DMControlType {
  return v !== undefined && (DM_CONTROL_TYPES as readonly string[]).includes(v);
}

// ─── Parse ───────────────────────────────────────────────────────────

/** Classify an unwrapped rumor. Never throws; unparseable input → `unknown`. */
export function parseDMWire(dm: UnwrappedDM, myPubkey: string): DMWireEvent {
  const tags = Array.isArray(dm.tags) ? dm.tags : [];
  const { conversationId, participants, isRoom } = conversationIdOf({ sender: dm.sender, tags }, myPubkey);
  const base: DMWireBase = {
    sender: dm.sender,
    wrapId: dm.wrapId,
    rumorId: dm.rumorId,
    createdAt: dm.createdAt,
    conversationId,
    participants,
    isRoom,
    subject: tagValue(tags, "subject"),
    expiration: dm.expiration,
    legacy: false,
    tags,
  };
  const unknown = (reason: string): DMWireEvent => ({ ...base, type: "unknown", reason });

  const typeTag = tagValue(tags, "type");

  switch (dm.kind) {
    case KIND_DM_MESSAGE: {
      if (typeTag !== undefined) {
        if (!isControlType(typeTag)) return unknown(`unknown type ${typeTag}`);
        const target = tagValue(tags, "e");
        switch (typeTag) {
          case "dm_edit":
            if (!target || !HEX64_RE.test(target)) return unknown("dm_edit without e");
            return { ...base, type: "edit", targetRumorId: target, content: dm.content };
          case "dm_delete":
            if (!target || !HEX64_RE.test(target)) return unknown("dm_delete without e");
            return { ...base, type: "delete", targetRumorId: target };
          case "dm_reaction": {
            if (!target || !HEX64_RE.test(target)) return unknown("dm_reaction without e");
            const emoji = dm.content.trim();
            if (!emoji) return unknown("dm_reaction without emoji");
            return {
              ...base,
              legacy: true,
              type: "reaction",
              targetRumorId: target,
              emoji,
              emojiTags: tags.filter((t) => t[0] === "emoji"),
            };
          }
          case "dm_reaction_remove": {
            if (!target || !HEX64_RE.test(target)) return unknown("dm_reaction_remove without e");
            const emoji = dm.content.trim();
            if (!emoji) return unknown("dm_reaction_remove without emoji");
            return { ...base, type: "reaction_remove", targetRumorId: target, emoji };
          }
          case "friend_request":
          case "friend_request_accept":
          case "friend_request_remove":
          case "call_invite":
          case "call_decline":
          case "call_missed":
            return { ...base, type: typeTag, content: dm.content };
        }
      }
      // Plain text. Reply anchor: `e` (spec) first, then legacy `q`.
      const e = tagValue(tags, "e");
      const q = tagValue(tags, "q");
      const replyTo = e && HEX64_RE.test(e) ? e : q && HEX64_RE.test(q) ? q : undefined;
      const legacy = !e && !!replyTo;
      const quote = e && q && HEX64_RE.test(q) ? q : undefined;
      return {
        ...base,
        legacy,
        type: "text",
        content: dm.content,
        replyTo,
        quote,
        emojiTags: tags.filter((t) => t[0] === "emoji"),
      };
    }

    case KIND_DM_FILE: {
      const url = dm.content.trim();
      const fileType = tagValue(tags, "file-type");
      const algorithm = tagValue(tags, "encryption-algorithm");
      const key = tagValue(tags, "decryption-key");
      const nonce = tagValue(tags, "decryption-nonce");
      const x = tagValue(tags, "x");
      const ox = tagValue(tags, "ox");
      if (!/^https?:\/\//i.test(url)) return unknown("file without url");
      if (!fileType) return unknown("file without file-type");
      if (algorithm !== DM_FILE_ALGORITHM) return unknown(`unsupported encryption ${algorithm}`);
      if (!key || !/^[0-9a-f]{64}$/i.test(key)) return unknown("file without decryption-key");
      if (!nonce || !/^[0-9a-f]{24}$/i.test(nonce)) return unknown("file without decryption-nonce");
      if (!x || !HEX64_RE.test(x)) return unknown("file without x");
      if (!ox || !HEX64_RE.test(ox)) return unknown("file without ox");
      const sizeRaw = tagValue(tags, "size");
      const durationRaw = tagValue(tags, "duration");
      const fallback = tagValues(tags, "fallback");
      const file: DMFileMeta = {
        url,
        fileType,
        key: key.toLowerCase(),
        nonce: nonce.toLowerCase(),
        x: x.toLowerCase(),
        ox: ox.toLowerCase(),
      };
      if (sizeRaw && Number.isFinite(Number(sizeRaw))) file.size = Number(sizeRaw);
      const dim = tagValue(tags, "dim");
      if (dim && /^\d+x\d+$/.test(dim)) file.dim = dim;
      const blurhash = tagValue(tags, "blurhash");
      if (blurhash) file.blurhash = blurhash;
      const thumb = tagValue(tags, "thumb");
      if (thumb && /^https?:\/\//i.test(thumb)) file.thumb = thumb;
      if (fallback.length > 0) file.fallback = fallback;
      if (durationRaw && Number.isFinite(Number(durationRaw))) file.duration = Number(durationRaw);
      const e = tagValue(tags, "e");
      return { ...base, type: "file", file, replyTo: e && HEX64_RE.test(e) ? e : undefined };
    }

    case KIND_REACTION: {
      // NIP-25: the LAST `e` tag is the reacted-to event.
      const target = lastTagValue(tags, "e");
      if (!target || !HEX64_RE.test(target)) return unknown("reaction without e");
      const raw = dm.content.trim();
      const emoji = raw === "" ? "+" : raw;
      return {
        ...base,
        type: "reaction",
        targetRumorId: target,
        emoji,
        emojiTags: tags.filter((t) => t[0] === "emoji"),
      };
    }

    case KIND_DM_TYPING:
      return { ...base, type: "typing" };

    case KIND_DM_RECEIPT: {
      const status = tagValue(tags, "status");
      if (status !== "delivered" && status !== "read") return unknown("receipt without status");
      const rumorIds = tagValues(tags, "e").filter((id) => HEX64_RE.test(id)).slice(0, 50);
      if (rumorIds.length === 0) return unknown("receipt without e");
      return { ...base, type: "receipt", status, rumorIds };
    }

    default:
      return unknown(`unsupported kind ${dm.kind}`);
  }
}

// ─── Build (extra tags for buildRumor / buildGroupRumor) ─────────────

export interface TextRumorOptions {
  /** Rumor id this replies to → `["e", id, relayHint]`. */
  replyTo?: string;
  replyRelayHint?: string;
  /** Rumor id quoted in the content → `["q", id]`. */
  quote?: string;
  subject?: string;
  /** NIP-30 `["emoji", shortcode, url]` tags. */
  emojiTags?: string[][];
  /** Explicit room id → `["g", roomId]`. */
  roomId?: string;
}

/** Extra tags for a kind-14 text rumor (spec write form). */
export function textRumorTags(opts: TextRumorOptions = {}): string[][] {
  const tags: string[][] = [];
  if (opts.replyTo) tags.push(["e", opts.replyTo, opts.replyRelayHint ?? ""]);
  if (opts.quote) tags.push(["q", opts.quote]);
  if (opts.subject) tags.push(["subject", opts.subject]);
  if (opts.roomId) tags.push(["g", opts.roomId]);
  if (opts.emojiTags) tags.push(...opts.emojiTags.filter((t) => t[0] === "emoji"));
  return tags;
}

/** Extra tags for a kind-15 file rumor. `content` must be `meta.url`. */
export function fileRumorTags(
  meta: Omit<DMFileMeta, "url">,
  opts: Pick<TextRumorOptions, "replyTo" | "replyRelayHint" | "roomId"> = {},
): string[][] {
  const tags: string[][] = [
    ["file-type", meta.fileType],
    ["encryption-algorithm", DM_FILE_ALGORITHM],
    ["decryption-key", meta.key],
    ["decryption-nonce", meta.nonce],
    ["x", meta.x],
    ["ox", meta.ox],
  ];
  if (meta.size !== undefined) tags.push(["size", String(meta.size)]);
  if (meta.dim) tags.push(["dim", meta.dim]);
  if (meta.blurhash) tags.push(["blurhash", meta.blurhash]);
  if (meta.thumb) tags.push(["thumb", meta.thumb]);
  for (const f of meta.fallback ?? []) tags.push(["fallback", f]);
  if (meta.duration !== undefined) tags.push(["duration", String(meta.duration)]);
  if (opts.replyTo) tags.push(["e", opts.replyTo, opts.replyRelayHint ?? ""]);
  if (opts.roomId) tags.push(["g", opts.roomId]);
  return tags;
}

/** Extra tags for a kind-7 reaction rumor (spec write form). Content = emoji. */
export function reactionRumorTags(opts: {
  targetRumorId: string;
  /** Kind of the reacted-to rumor (14 or 15). */
  targetKind?: number;
  /** NIP-30 tag for a custom emoji reaction. */
  emojiTag?: string[];
  roomId?: string;
}): string[][] {
  const tags: string[][] = [
    ["e", opts.targetRumorId],
    ["k", String(opts.targetKind ?? KIND_DM_MESSAGE)],
  ];
  if (opts.emojiTag && opts.emojiTag[0] === "emoji") tags.push(opts.emojiTag);
  if (opts.roomId) tags.push(["g", opts.roomId]);
  return tags;
}

/** Extra tags for a typed kind-14 control rumor (edit / delete / un-react /
 *  friend / call). `targetRumorId` is required for the first three. */
export function controlRumorTags(
  type: Exclude<DMControlType, "dm_reaction">,
  opts: { targetRumorId?: string; roomId?: string } = {},
): string[][] {
  const needsTarget = type === "dm_edit" || type === "dm_delete" || type === "dm_reaction_remove";
  if (needsTarget && !opts.targetRumorId) throw new Error(`${type} needs a target rumor id`);
  const tags: string[][] = [["type", type]];
  if (opts.targetRumorId) tags.push(["e", opts.targetRumorId]);
  if (opts.roomId) tags.push(["g", opts.roomId]);
  return tags;
}

/** Extra tags for a typing rumor (kind 20014). Content should be "". */
export function typingRumorTags(opts: { roomId?: string } = {}): string[][] {
  return opts.roomId ? [["g", opts.roomId]] : [];
}

/** Extra tags for a receipt rumor (kind 20015). Content should be "". */
export function receiptRumorTags(
  status: DMReceiptStatus,
  rumorIds: string[],
  opts: { roomId?: string } = {},
): string[][] {
  const ids = Array.from(new Set(rumorIds.filter((id) => HEX64_RE.test(id)))).slice(0, 50);
  if (ids.length === 0) throw new Error("a receipt needs at least one rumor id");
  const tags: string[][] = [["status", status], ...ids.map((id) => ["e", id])];
  if (opts.roomId) tags.push(["g", opts.roomId]);
  return tags;
}

/** The seal/wrap `expiration` a rumor class gets, relative to `createdAt`
 *  (§5). `undefined` = no expiration. */
export function defaultExpirationFor(
  cls: "typing" | "receipt" | "call" | "message",
  createdAt: number,
  /** Per-conversation disappearing-messages timer, seconds (0/undefined = off). */
  disappearAfter?: number,
): number | undefined {
  switch (cls) {
    case "typing":
      return createdAt + DM_EXPIRATION_SECONDS.typing;
    case "receipt":
      return createdAt + DM_EXPIRATION_SECONDS.receipt;
    case "call":
      return createdAt + DM_EXPIRATION_SECONDS.call;
    case "message":
      return disappearAfter && disappearAfter > 0 ? createdAt + disappearAfter : undefined;
  }
}
