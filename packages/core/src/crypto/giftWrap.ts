// NIP-17/NIP-59 gift-wrap construction + unwrapping — platform-free.
//
// Moved from client/src/lib/nostr/giftWrap.ts (Phase 0). Differences from the
// desktop original, by design:
//  - No Redux/store access: the caller passes a `GiftWrapContext` carrying the
//    logged-in pubkey and a `SignerAdapter` (the one core signer interface).
//    The desktop shim rebuilds its old module API on top (signing queue
//    included); mobile passes its LocalNsecSigner directly.
//  - Event ids come from nostr-tools' `getEventHash` (@noble sha256 under the
//    hood) instead of `crypto.subtle.digest`, so this runs without Web Crypto
//    (Hermes, Node, workers) — guide 05 §4.

import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { nip44EncryptWithKey } from "./nip44";
import { KIND_SEAL, KIND_DM_MESSAGE, KIND_GIFT_WRAP } from "../kinds";
import type { SignerAdapter } from "../adapters";
import type { NostrEvent, UnsignedEvent } from "@thewired/shared-types";

const TWO_DAYS = 2 * 24 * 60 * 60;

/** NIP-59: seal/wrap timestamps are randomized up to 2 days in the past so
 *  relay metadata can't order conversations. (The rumor keeps the real time.) */
function randomTimestamp(): number {
  return Math.round(Date.now() / 1000 - Math.random() * TWO_DAYS);
}

/** NIP-01 event id via @noble sha256 (no Web Crypto). Unlike nostr-tools'
 *  getEventHash this doesn't validate field shapes — rumor ids must be
 *  computable for any pubkey string, matching the desktop original. */
function getEventId(event: {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(utf8ToBytes(serialized)));
}

/** Who we are + how we sign/encrypt. The only platform-specific inputs. */
export interface GiftWrapContext {
  /** The logged-in user's pubkey (hex). */
  myPubkey: string;
  /** Sign seals + run user-key NIP-44. Implementations must already be
   *  serialized through the platform's signing queue where one exists. */
  signer: SignerAdapter;
}

/** An unsigned kind:14 rumor with its precomputed id. */
export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface UnwrappedDM {
  sender: string;
  content: string;
  tags: string[][];
  createdAt: number;
  wrapId: string;
  /** The rumor's event ID — used to reference this message for edits/deletes */
  rumorId?: string;
}

/** Result of creating a gift-wrapped DM pair */
export interface GiftWrapResult {
  /** The gift wrap event to publish */
  wrap: NostrEvent;
  /** The rumor ID (shared between recipient + self wraps) */
  rumorId: string;
}

/**
 * Build a shared rumor for a DM. Both the recipient wrap and self wrap
 * use the same rumor (same ID) so edits/deletes can reference it.
 */
export async function buildRumor(
  myPubkey: string,
  recipientPubkey: string,
  content: string,
  extraTags?: string[][],
): Promise<Rumor> {
  const rumorTags: string[][] = [["p", recipientPubkey]];
  if (extraTags) rumorTags.push(...extraTags);

  const rumor = {
    pubkey: myPubkey,
    created_at: Math.round(Date.now() / 1000),
    kind: KIND_DM_MESSAGE,
    tags: rumorTags,
    content,
  };
  return { ...rumor, id: getEventId(rumor) };
}

/** Seal the rumor to `sealTo` with the user's key, then wrap the seal to
 *  `wrapTo` with a fresh ephemeral key. The recipient wrap uses
 *  sealTo = wrapTo = recipient; the self wrap uses sealTo = wrapTo = self. */
async function sealAndWrap(
  ctx: GiftWrapContext,
  rumor: Rumor,
  sealTo: string,
  wrapTo: string,
): Promise<NostrEvent> {
  // Encrypt rumor and create seal (kind:13) with the user's key
  const encryptedRumor = await ctx.signer.nip44Encrypt(sealTo, JSON.stringify(rumor));

  const sealUnsigned: UnsignedEvent = {
    pubkey: ctx.myPubkey,
    created_at: randomTimestamp(),
    kind: KIND_SEAL,
    tags: [],
    content: encryptedRumor,
  };
  const seal = await ctx.signer.signEvent(sealUnsigned);

  // Ephemeral keypair → encrypt seal → sign gift wrap (kind:1059)
  const ephemeralSk = generateSecretKey();
  const ephemeralPk = getPublicKey(ephemeralSk);
  const encryptedSeal = nip44EncryptWithKey(ephemeralSk, wrapTo, JSON.stringify(seal));

  const wrapEvent = {
    pubkey: ephemeralPk,
    created_at: randomTimestamp(),
    kind: KIND_GIFT_WRAP,
    tags: [["p", wrapTo]],
    content: encryptedSeal,
  };
  return finalizeEvent(wrapEvent, ephemeralSk) as unknown as NostrEvent;
}

/**
 * Create a NIP-17 gift-wrapped DM.
 *
 * Flow:
 * 1. Build rumor (unsigned kind:14)
 * 2. Sign seal (kind:13) with user's signer, encrypting rumor via NIP-44
 * 3. Generate ephemeral keypair
 * 4. Encrypt seal with ephemeral key → recipient
 * 5. Sign gift wrap (kind:1059) with ephemeral key
 *
 * Returns the gift wrap event + the shared rumor ID.
 */
export async function createGiftWrappedDM(
  ctx: GiftWrapContext,
  content: string,
  recipientPubkey: string,
  extraTags?: string[][],
  /** Pre-built rumor to reuse (for shared ID between recipient + self wrap) */
  sharedRumor?: Rumor,
): Promise<GiftWrapResult> {
  const rumor = sharedRumor ?? (await buildRumor(ctx.myPubkey, recipientPubkey, content, extraTags));
  const wrap = await sealAndWrap(ctx, rumor, recipientPubkey, recipientPubkey);
  return { wrap, rumorId: rumor.id };
}

/**
 * Create a gift-wrapped DM to self (so sender can see their own messages).
 * Same as createGiftWrappedDM but wraps to self instead of recipient.
 * Uses the same rumor for a shared ID.
 */
export async function createSelfWrap(
  ctx: GiftWrapContext,
  content: string,
  recipientPubkey: string,
  extraTags?: string[][],
  /** Pre-built rumor to reuse (for shared ID between recipient + self wrap) */
  sharedRumor?: Rumor,
): Promise<GiftWrapResult> {
  const rumor = sharedRumor ?? (await buildRumor(ctx.myPubkey, recipientPubkey, content, extraTags));
  const wrap = await sealAndWrap(ctx, rumor, ctx.myPubkey, ctx.myPubkey);
  return { wrap, rumorId: rumor.id };
}

/**
 * Unwrap a received gift wrap event (kind:1059).
 *
 * Flow:
 * 1. Decrypt content with nip44Decrypt(giftWrap.pubkey, ...)
 * 2. Parse seal (kind:13)
 * 3. Decrypt seal content with nip44Decrypt(seal.pubkey, ...)
 * 4. Parse rumor (kind:14)
 * 5. Return unwrapped DM
 *
 * Fails closed: any mismatch (wrong kinds, sender inconsistency, content that
 * still looks encrypted) throws rather than returning suspect plaintext.
 */
export async function unwrapGiftWrap(
  codec: Pick<SignerAdapter, "nip44Decrypt">,
  giftWrapEvent: NostrEvent,
): Promise<UnwrappedDM> {
  // Step 1: Decrypt the gift wrap content using ephemeral pubkey
  const sealJson = await codec.nip44Decrypt(giftWrapEvent.pubkey, giftWrapEvent.content);

  // Step 2: Parse seal
  const seal = JSON.parse(sealJson) as NostrEvent;
  if (seal.kind !== KIND_SEAL) {
    throw new Error(`Expected seal (kind:13), got kind:${seal.kind}`);
  }

  // Step 3: Decrypt seal content using seal's author pubkey
  const rumorJson = await codec.nip44Decrypt(seal.pubkey, seal.content);

  // Step 4: Parse rumor
  const rumor = JSON.parse(rumorJson) as {
    id?: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  };

  // Validate rumor kind — must be kind:14 (DM). Some NIP-07 extensions
  // return garbage on wrong-key decryption that can survive JSON.parse
  // (e.g. returning the seal itself as the "decrypted" content). Checking
  // the kind catches this: a seal (kind:13) mistakenly returned as a rumor
  // would fail here, preventing its encrypted content from leaking through.
  if (rumor.kind !== KIND_DM_MESSAGE) {
    throw new Error(`Expected rumor (kind:${KIND_DM_MESSAGE}), got kind:${rumor.kind}`);
  }

  // Verify sender consistency
  if (rumor.pubkey !== seal.pubkey) {
    throw new Error("Rumor pubkey does not match seal pubkey");
  }

  // Guard against content that is still encrypted (base64 ciphertext).
  // If nip44Decrypt silently returned garbage that parsed as JSON with a
  // base64-only content field, reject it.
  if (
    typeof rumor.content !== "string" ||
    (rumor.content.length > 50 && /^[A-Za-z0-9+/=]+$/.test(rumor.content))
  ) {
    throw new Error("Rumor content appears to still be encrypted");
  }

  return {
    sender: seal.pubkey,
    content: rumor.content,
    tags: rumor.tags,
    createdAt: rumor.created_at,
    wrapId: giftWrapEvent.id,
    rumorId: rumor.id,
  };
}
