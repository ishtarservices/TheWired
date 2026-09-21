// DM send paths — wire contract v1 (docs/DM_WIRE_CONTRACT.md).
//
// Write the spec form: `e` reply anchors, kind-7 reactions, kind-15 encrypted
// files, seal+wrap `expiration` for disappearing chats / typing / receipts.
// Edits, deletes and un-react stay typed kind-14 rumors (no spec form exists).
// Every message is sent as a recipient wrap + a self-wrap sharing one rumor;
// rooms fan out one wrap per participant. Self-wrap failures are surfaced on
// the message (syncWarning) instead of a console line.

import { nip19 } from "nostr-tools";
import {
  textRumorTags,
  fileRumorTags,
  reactionRumorTags,
  controlRumorTags,
  typingRumorTags,
  receiptRumorTags,
  defaultExpirationFor,
  KIND_DM_MESSAGE,
  KIND_DM_FILE,
  KIND_REACTION,
  KIND_DM_TYPING,
  KIND_DM_RECEIPT,
} from "@ishtarservices/core";
import { DM_EDIT_WINDOW_SECONDS } from "@ishtarservices/shared-types";
import type { DMFileMeta, DMReceiptStatus } from "@ishtarservices/shared-types";
import { createGiftWrappedDM, createSelfWrap, buildRumor } from "@/lib/nostr/giftWrap";
import { createGroupMessageWraps } from "@/lib/nostr/nip17Room";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, getOwnDMRelays, fallbackDMRelays } from "@/lib/nostr/dmRelayList";
import { buildMuteListEvent } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { store } from "@/store";
import {
  addDMMessage,
  editDMMessage,
  remoteDeleteDMMessage,
  reactDMMessage,
  removeDMReaction as removeDMReactionAction,
  markDMSyncWarning,
  conversationExpireAfter,
  upsertRoom,
  type DMContact,
} from "@/store/slices/dmSlice";
import { setMuteList } from "@/store/slices/identitySlice";
import { getDMPrefs } from "./dmPrefs";

export { DM_EDIT_WINDOW_SECONDS };

/** Resolve an npub or hex string to a 64-char hex pubkey. */
function resolveHexPubkey(input: string): string {
  if (/^[0-9a-f]{64}$/i.test(input)) return input;
  try {
    const decoded = nip19.decode(input);
    if (decoded.type === "npub") return decoded.data;
  } catch {
    // fall through to error
  }
  throw new Error("Invalid recipient. Provide an npub or 64-character hex pubkey.");
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function roomOf(conversationId: string): DMContact | undefined {
  const c = store.getState().dm.contacts.find((c) => c.pubkey === conversationId);
  return c?.isRoom ? c : undefined;
}

/** A "friend" for typing/receipt purposes: accepted request + followed. */
export function isFriend(pubkey: string): boolean {
  const s = store.getState();
  if (!s.identity.followList.includes(pubkey)) return false;
  return s.friendRequests.requests.some((r) => r.pubkey === pubkey && r.status === "accepted");
}

interface PublishResult {
  rumorId: string;
  createdAt: number;
  selfWrapId: string;
  /** Relays the recipient wrap(s) reached. */
  sent: number;
  /** Relays the self-wrap reached (0 = not synced to our other devices). */
  selfSent: number;
}

/**
 * Build one rumor, wrap it for every recipient (+ self unless `noSelfWrap`)
 * and publish. Works for 1:1 and rooms.
 */
async function publishRumor(
  conversationId: string,
  content: string,
  extraTags: string[][],
  opts: { kind?: number; expiration?: number; noSelfWrap?: boolean } = {},
): Promise<PublishResult> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  if (relayManager.getWriteRelays().length === 0) {
    throw new Error("No write relays connected. Please check your connection and try again.");
  }
  const wrapOpts = opts.expiration !== undefined ? { expiration: opts.expiration } : undefined;
  const room = roomOf(conversationId);

  if (room) {
    const participants = room.participants ?? [];
    const result = await createGroupMessageWraps(content, participants, myPubkey, {
      roomId: room.pubkey,
      subject: room.subject,
      extraTags,
      kind: opts.kind,
      expiration: opts.expiration,
      noSelfWrap: opts.noSelfWrap,
    });
    let sent = 0;
    let selfSent = 0;
    let selfWrapId = "";
    for (const { to, wrap } of result.wraps) {
      if (to === myPubkey) {
        const own = getOwnDMRelays();
        selfSent = relayManager.publish(wrap, own.length > 0 ? own : fallbackDMRelays());
        selfWrapId = wrap.id;
      } else {
        sent += relayManager.publish(wrap, (await getDMRelaysForPublish(to)) ?? fallbackDMRelays());
      }
    }
    return { rumorId: result.rumorId, createdAt: nowSec(), selfWrapId, sent, selfSent };
  }

  const peer = resolveHexPubkey(conversationId);
  const sharedRumor = await buildRumor(myPubkey, peer, content, extraTags.length > 0 ? extraTags : undefined, {
    kind: opts.kind ?? KIND_DM_MESSAGE,
  });
  const { wrap: recipientWrap } = await createGiftWrappedDM(content, peer, extraTags, sharedRumor, wrapOpts);
  const sent = relayManager.publish(recipientWrap, (await getDMRelaysForPublish(peer)) ?? fallbackDMRelays());
  let selfSent = 0;
  let selfWrapId = "";
  if (!opts.noSelfWrap) {
    const { wrap: selfWrap } = await createSelfWrap(content, peer, extraTags, sharedRumor, wrapOpts);
    const own = getOwnDMRelays();
    selfSent = relayManager.publish(selfWrap, own.length > 0 ? own : fallbackDMRelays());
    selfWrapId = selfWrap.id;
  }
  return { rumorId: sharedRumor.id, createdAt: sharedRumor.created_at, selfWrapId, sent, selfSent };
}

/** Seal/wrap expiration for an ordinary message in this conversation
 *  (disappearing-messages timer from the read-state record). */
function messageExpiration(conversationId: string, createdAt: number): number | undefined {
  return defaultExpirationFor("message", createdAt, conversationExpireAfter(store.getState().dm.flags, conversationId));
}

/**
 * Send a text DM (kind 14). Replies carry the target's RUMOR id in an `e` tag
 * (spec form); `q` is only written for a true quote.
 */
export async function sendDM(
  conversationId: string,
  content: string,
  /** The message being replied to. Its rumorId is the anchor; wrapId only
   *  when a legacy row never stored one. */
  replyTo?: { wrapId: string; rumorId?: string },
  emojiTags?: string[][],
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const room = roomOf(conversationId);
  const target = room ? conversationId : resolveHexPubkey(conversationId);

  const replyAnchor = replyTo ? (replyTo.rumorId ?? replyTo.wrapId) : undefined;
  const extraTags = textRumorTags({ replyTo: replyAnchor, emojiTags });
  const createdAt = nowSec();
  const r = await publishRumor(target, content, extraTags, {
    expiration: messageExpiration(target, createdAt),
  });
  if (r.sent === 0) throw new Error("Failed to publish DM: no write relays available.");

  store.dispatch(
    addDMMessage({
      partnerPubkey: target,
      myPubkey,
      message: {
        id: r.selfWrapId,
        senderPubkey: myPubkey,
        content,
        createdAt: r.createdAt,
        wrapId: r.selfWrapId,
        rumorId: r.rumorId,
        replyToWrapId: replyAnchor,
        emojiTags: emojiTags && emojiTags.length > 0 ? emojiTags : undefined,
        expiresAt: messageExpiration(target, r.createdAt),
        syncWarning: r.selfSent === 0 ? true : undefined,
      },
      room: room ? { participants: room.participants ?? [], subject: room.subject } : undefined,
    }),
  );
}

/**
 * Send an encrypted file message (kind 15). `meta` comes from
 * `encryptDMFile` + the Blossom upload; the caption (if any) follows as a
 * text reply to the file rumor.
 */
export async function sendDMFile(
  conversationId: string,
  meta: DMFileMeta,
  opts: { caption?: string; replyTo?: { wrapId: string; rumorId?: string } } = {},
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const room = roomOf(conversationId);
  const target = room ? conversationId : resolveHexPubkey(conversationId);
  const replyAnchor = opts.replyTo ? (opts.replyTo.rumorId ?? opts.replyTo.wrapId) : undefined;
  const { url, ...rest } = meta;
  const createdAt = nowSec();
  const r = await publishRumor(target, url, fileRumorTags(rest, { replyTo: replyAnchor }), {
    kind: KIND_DM_FILE,
    expiration: messageExpiration(target, createdAt),
  });
  if (r.sent === 0) throw new Error("Failed to publish file: no write relays available.");

  store.dispatch(
    addDMMessage({
      partnerPubkey: target,
      myPubkey,
      message: {
        id: r.selfWrapId,
        senderPubkey: myPubkey,
        content: "",
        createdAt: r.createdAt,
        wrapId: r.selfWrapId,
        rumorId: r.rumorId,
        replyToWrapId: replyAnchor,
        kind: KIND_DM_FILE,
        attachment: meta,
        expiresAt: messageExpiration(target, r.createdAt),
        syncWarning: r.selfSent === 0 ? true : undefined,
      },
      room: room ? { participants: room.participants ?? [], subject: room.subject } : undefined,
    }),
  );

  if (opts.caption && opts.caption.trim()) {
    await sendDM(target, opts.caption.trim(), { wrapId: r.selfWrapId, rumorId: r.rumorId });
  }
}

/**
 * Edit a DM by sending a typed `dm_edit` rumor anchored on the original
 * rumor id. The 24-hour window is advisory (UI only).
 */
export async function editDM(
  conversationId: string,
  originalRumorId: string,
  newContent: string,
  originalCreatedAt: number,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  if (nowSec() - originalCreatedAt > DM_EDIT_WINDOW_SECONDS) throw new Error("Edit window has expired");
  const target = roomOf(conversationId) ? conversationId : resolveHexPubkey(conversationId);

  const r = await publishRumor(target, newContent, controlRumorTags("dm_edit", { targetRumorId: originalRumorId }));
  store.dispatch(
    editDMMessage({
      partnerPubkey: target,
      rumorId: originalRumorId,
      newContent,
      editedAt: nowSec(),
      senderPubkey: myPubkey,
      wrapId: r.selfWrapId,
    }),
  );
}

/** Delete a DM for everyone (typed `dm_delete` rumor; best-effort). */
export async function deleteDMForEveryone(conversationId: string, originalRumorId: string): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const target = roomOf(conversationId) ? conversationId : resolveHexPubkey(conversationId);

  const r = await publishRumor(target, "", controlRumorTags("dm_delete", { targetRumorId: originalRumorId }));
  store.dispatch(
    remoteDeleteDMMessage({
      partnerPubkey: target,
      rumorId: originalRumorId,
      senderPubkey: myPubkey,
      wrapId: r.selfWrapId,
    }),
  );
}

/** React to a DM with a unicode emoji — a kind-7 rumor (spec form). */
export async function reactToDM(conversationId: string, targetRumorId: string, emoji: string): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const content = emoji.trim();
  if (!content) throw new Error("Reaction emoji is required");
  if (!/^[0-9a-f]{64}$/i.test(targetRumorId)) throw new Error("Invalid reaction target");
  const target = roomOf(conversationId) ? conversationId : resolveHexPubkey(conversationId);

  const r = await publishRumor(target, content, reactionRumorTags({ targetRumorId }), { kind: KIND_REACTION });
  store.dispatch(
    reactDMMessage({ partnerPubkey: target, rumorId: targetRumorId, emoji: content, reactorPubkey: myPubkey, wrapId: r.selfWrapId }),
  );
}

/** Remove our own emoji reaction — typed `dm_reaction_remove` (no spec form). */
export async function removeDMReaction(conversationId: string, targetRumorId: string, emoji: string): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const content = emoji.trim();
  if (!content) throw new Error("Reaction emoji is required");
  const target = roomOf(conversationId) ? conversationId : resolveHexPubkey(conversationId);

  const r = await publishRumor(target, content, controlRumorTags("dm_reaction_remove", { targetRumorId }));
  store.dispatch(
    removeDMReactionAction({ partnerPubkey: target, rumorId: targetRumorId, emoji: content, reactorPubkey: myPubkey, wrapId: r.selfWrapId }),
  );
}

// ─── Presence: typing + receipts (best-effort, friends only, opt-out) ───

const TYPING_THROTTLE_MS = 5000;
const lastTypingAt = new Map<string, number>();

/** Whether presence rumors may go to this conversation: every other
 *  participant must be a friend and the pref must be on. */
function presenceAllowed(conversationId: string, pref: "typing" | "receipts"): boolean {
  if (!getDMPrefs()[pref]) return false;
  const my = store.getState().identity.pubkey;
  const room = roomOf(conversationId);
  const others = room ? (room.participants ?? []).filter((p) => p !== my) : [conversationId];
  return others.length > 0 && others.every(isFriend);
}

/** Send a typing hint (kind 20014, 30-s expiry, no self-wrap), at most one per 5 s. */
export async function sendTyping(conversationId: string): Promise<void> {
  if (!presenceAllowed(conversationId, "typing")) return;
  const now = Date.now();
  const last = lastTypingAt.get(conversationId) ?? 0;
  if (now - last < TYPING_THROTTLE_MS) return;
  lastTypingAt.set(conversationId, now);
  try {
    await publishRumor(conversationId, "", typingRumorTags(), {
      kind: KIND_DM_TYPING,
      expiration: defaultExpirationFor("typing", nowSec()),
      noSelfWrap: true,
    });
  } catch {
    // presence is best-effort
  }
}

/** Send a delivered/read receipt (kind 20015, 7-d expiry, no self-wrap). */
export async function sendReceipt(
  conversationId: string,
  status: DMReceiptStatus,
  rumorIds: string[],
): Promise<void> {
  if (rumorIds.length === 0 || !presenceAllowed(conversationId, "receipts")) return;
  try {
    await publishRumor(conversationId, "", receiptRumorTags(status, rumorIds), {
      kind: KIND_DM_RECEIPT,
      expiration: defaultExpirationFor("receipt", nowSec()),
      noSelfWrap: true,
    });
  } catch {
    // best-effort
  }
}

// ─── Rooms ───

/** Create a NIP-17 room (≤ 10 participants) with a stable random room id. */
export function createRoom(participants: string[], subject?: string): string {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const members = Array.from(new Set([myPubkey, ...participants.map(resolveHexPubkey)]));
  if (members.length < 3) throw new Error("A room needs at least two other people");
  if (members.length > 10) throw new Error("Rooms are limited to 10 people");
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const roomId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  store.dispatch(upsertRoom({ conversationId: roomId, participants: members, subject: subject?.trim() || undefined }));
  return roomId;
}

// ─── Block ───

/**
 * Block a pubkey: add it to the public kind-10000 mute list (NIP-51) and drop
 * its wraps locally (the pipeline checks the mute list before rendering).
 */
export async function blockPeer(pubkey: string): Promise<void> {
  const s = store.getState();
  const myPubkey = s.identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const target = resolveHexPubkey(pubkey);
  if (s.identity.muteList.some((m) => m.type === "pubkey" && m.value === target)) return;
  const mutes = [...s.identity.muteList, { type: "pubkey" as const, value: target }];
  const unsigned = buildMuteListEvent(myPubkey, mutes);
  store.dispatch(setMuteList({ mutes, createdAt: unsigned.created_at }));
  try {
    await signAndPublish(unsigned);
  } catch (err) {
    store.dispatch(setMuteList({ mutes: s.identity.muteList, createdAt: unsigned.created_at + 1 }));
    throw err;
  }
}

/** Undo `blockPeer`. */
export async function unblockPeer(pubkey: string): Promise<void> {
  const s = store.getState();
  const myPubkey = s.identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");
  const target = resolveHexPubkey(pubkey);
  const mutes = s.identity.muteList.filter((m) => !(m.type === "pubkey" && m.value === target));
  if (mutes.length === s.identity.muteList.length) return;
  const unsigned = buildMuteListEvent(myPubkey, mutes);
  store.dispatch(setMuteList({ mutes, createdAt: unsigned.created_at }));
  await signAndPublish(unsigned);
}

/** Re-flag or clear the sync warning after a retry (used by the outbox). */
export function noteSelfWrapResult(conversationId: string, wrapId: string, ok: boolean): void {
  store.dispatch(markDMSyncWarning({ partnerPubkey: conversationId, wrapId, warning: !ok }));
}
