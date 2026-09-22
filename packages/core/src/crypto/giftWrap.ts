// NIP-17/NIP-59 gift-wrap construction + unwrapping — platform-free.
//
// Differences from the original desktop module, by design:
//  - No Redux/store access: the caller passes a `GiftWrapContext` carrying the
//    logged-in pubkey and a `SignerAdapter` (the one core signer interface).
//  - Event ids come from @noble sha256, so this runs without Web Crypto
//    (Hermes, Node, workers).
//
// Wire contract (docs/DM_WIRE_CONTRACT.md §1): the receiver verifies the seal
// signature, recomputes the rumor id, checks the rumor kind against an
// allowlist and drops expired wraps/seals. Everything fails closed.

import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { nip44EncryptWithKey } from "./nip44";
import { verifyEventSync } from "./verifyEvent";
import { KIND_SEAL, KIND_DM_MESSAGE, KIND_GIFT_WRAP, DM_RUMOR_KINDS } from "../kinds";
import type { SignerAdapter } from "../adapters";
import type { NostrEvent, UnsignedEvent } from "@ishtarservices/shared-types";

const TWO_DAYS = 2 * 24 * 60 * 60;
const HEX64_RE = /^[0-9a-f]{64}$/i;

/** NIP-59: seal/wrap timestamps are randomized up to 2 days in the past so
 *  relay metadata can't order conversations. (The rumor keeps the real time.) */
function randomTimestamp(): number {
  return Math.round(Date.now() / 1000 - Math.random() * TWO_DAYS);
}

/** NIP-01 event id via @noble sha256 (no Web Crypto). Unlike nostr-tools'
 *  getEventHash this doesn't validate field shapes — rumor ids must be
 *  computable for any pubkey string. */
export function getEventId(event: {
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

function expirationOf(tags: unknown): number | undefined {
  if (!Array.isArray(tags)) return undefined;
  for (const t of tags) {
    if (Array.isArray(t) && t[0] === "expiration" && typeof t[1] === "string") {
      const n = Number(t[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** Who we are + how we sign/encrypt. The only platform-specific inputs. */
export interface GiftWrapContext {
  /** The logged-in user's pubkey (hex). */
  myPubkey: string;
  /** Sign seals + run user-key NIP-44. Implementations must already be
   *  serialized through the platform's signing queue where one exists. */
  signer: SignerAdapter;
}

/** An unsigned rumor with its precomputed id. */
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
  /** The rumor's event id, recomputed by the receiver — the anchor for
   *  replies, edits, deletes and reactions. */
  rumorId: string;
  /** Rumor kind (14 text, 15 file, 7 reaction, 20014 typing, 20015 receipt…). */
  kind: number;
  /** Earliest `expiration` found on the wrap or seal, if any. */
  expiration?: number;
}

/** Result of creating a gift-wrapped DM pair */
export interface GiftWrapResult {
  /** The gift wrap event to publish */
  wrap: NostrEvent;
  /** The rumor ID (shared between recipient + self wraps) */
  rumorId: string;
}

export interface BuildRumorOptions {
  /** Rumor kind; defaults to 14. */
  kind?: number;
  /** Override created_at (tests / replays). */
  createdAt?: number;
}

export interface WrapOptions {
  /** NIP-40 `expiration` (unix seconds) placed on BOTH the seal and the wrap. */
  expiration?: number;
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
  opts?: BuildRumorOptions,
): Promise<Rumor> {
  const rumorTags: string[][] = [["p", recipientPubkey]];
  if (extraTags) rumorTags.push(...extraTags);

  const rumor = {
    pubkey: myPubkey,
    created_at: opts?.createdAt ?? Math.round(Date.now() / 1000),
    kind: opts?.kind ?? KIND_DM_MESSAGE,
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
  opts?: WrapOptions,
): Promise<NostrEvent> {
  const expirationTag: string[][] =
    opts?.expiration !== undefined ? [["expiration", String(Math.floor(opts.expiration))]] : [];

  // Encrypt rumor and create seal (kind:13) with the user's key
  const encryptedRumor = await ctx.signer.nip44Encrypt(sealTo, JSON.stringify(rumor));

  const sealUnsigned: UnsignedEvent = {
    pubkey: ctx.myPubkey,
    created_at: randomTimestamp(),
    kind: KIND_SEAL,
    tags: [...expirationTag],
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
    tags: [["p", wrapTo], ...expirationTag],
    content: encryptedSeal,
  };
  return finalizeEvent(wrapEvent, ephemeralSk) as unknown as NostrEvent;
}

/**
 * Create a NIP-17 gift-wrapped DM.
 *
 * Flow:
 * 1. Build rumor (unsigned)
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
  opts?: WrapOptions,
): Promise<GiftWrapResult> {
  const rumor = sharedRumor ?? (await buildRumor(ctx.myPubkey, recipientPubkey, content, extraTags));
  const wrap = await sealAndWrap(ctx, rumor, recipientPubkey, recipientPubkey, opts);
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
  opts?: WrapOptions,
): Promise<GiftWrapResult> {
  const rumor = sharedRumor ?? (await buildRumor(ctx.myPubkey, recipientPubkey, content, extraTags));
  const wrap = await sealAndWrap(ctx, rumor, ctx.myPubkey, ctx.myPubkey, opts);
  return { wrap, rumorId: rumor.id };
}

export interface UnwrapOptions {
  /** Rumor kinds to accept; defaults to DM_RUMOR_KINDS. */
  acceptKinds?: readonly number[];
  /** Verify the seal's schnorr signature (default true). Only disable for
   *  codec-simulation tests. */
  verifySeal?: boolean;
  /** "now" in unix seconds for expiration checks (default: wall clock). */
  now?: number;
}

/**
 * Unwrap a received gift wrap event (kind:1059).
 *
 * Flow:
 * 1. Reject an expired wrap (NIP-40)
 * 2. Decrypt content with nip44Decrypt(giftWrap.pubkey, ...)
 * 3. Parse + verify the seal (kind:13, signature, expiration)
 * 4. Decrypt seal content with nip44Decrypt(seal.pubkey, ...)
 * 5. Parse the rumor, check kind, sender consistency, recompute its id
 *
 * Fails closed: any mismatch (wrong kinds, bad signature, sender
 * inconsistency, tampered id, content that still looks encrypted) throws
 * rather than returning suspect plaintext.
 */
export async function unwrapGiftWrap(
  codec: Pick<SignerAdapter, "nip44Decrypt">,
  giftWrapEvent: NostrEvent,
  opts?: UnwrapOptions,
): Promise<UnwrappedDM> {
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  const acceptKinds = opts?.acceptKinds ?? DM_RUMOR_KINDS;

  // Step 1: NIP-40 — an expired wrap is dropped before we spend a decrypt on it.
  const wrapExpiration = expirationOf(giftWrapEvent.tags);
  if (wrapExpiration !== undefined && wrapExpiration <= now) {
    throw new Error("Gift wrap expired");
  }

  // Step 2: Decrypt the gift wrap content using ephemeral pubkey
  const sealJson = await codec.nip44Decrypt(giftWrapEvent.pubkey, giftWrapEvent.content);

  // Step 3: Parse + verify seal
  const seal = JSON.parse(sealJson) as NostrEvent;
  if (seal.kind !== KIND_SEAL) {
    throw new Error(`Expected seal (kind:13), got kind:${seal.kind}`);
  }
  if (opts?.verifySeal !== false) {
    if (
      typeof seal.id !== "string" ||
      typeof seal.sig !== "string" ||
      typeof seal.pubkey !== "string" ||
      !verifyEventSync(seal)
    ) {
      throw new Error("Seal signature invalid");
    }
  }
  const sealExpiration = expirationOf(seal.tags);
  if (sealExpiration !== undefined && sealExpiration <= now) {
    throw new Error("Seal expired");
  }

  // Step 4: Decrypt seal content using seal's author pubkey
  const rumorJson = await codec.nip44Decrypt(seal.pubkey, seal.content);

  // Step 5: Parse rumor
  const rumor = JSON.parse(rumorJson) as {
    id?: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  };

  // Validate rumor kind against the allowlist. Some NIP-07 extensions return
  // garbage on wrong-key decryption that can survive JSON.parse (e.g.
  // returning the seal itself as the "decrypted" content). Checking the kind
  // catches this: a seal (kind:13) mistakenly returned as a rumor fails here,
  // preventing its encrypted content from leaking through.
  if (typeof rumor.kind !== "number" || !acceptKinds.includes(rumor.kind)) {
    throw new Error(`Unsupported rumor kind:${rumor.kind}`);
  }

  // Shape checks — anchors and routing depend on these being well-formed.
  if (
    typeof rumor.pubkey !== "string" ||
    !HEX64_RE.test(rumor.pubkey) ||
    typeof rumor.created_at !== "number" ||
    !Array.isArray(rumor.tags) ||
    !rumor.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === "string"))
  ) {
    throw new Error("Rumor is malformed");
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

  // Recompute the rumor id: a sealer must not be able to choose the anchor
  // other messages (edits, deletes, reactions) will point at.
  const computedId = getEventId(rumor);
  if (rumor.id !== undefined && rumor.id !== computedId) {
    throw new Error("Rumor id mismatch");
  }

  const expirations = [wrapExpiration, sealExpiration].filter(
    (e): e is number => e !== undefined,
  );

  return {
    sender: seal.pubkey,
    content: rumor.content,
    tags: rumor.tags,
    createdAt: rumor.created_at,
    wrapId: giftWrapEvent.id,
    rumorId: computedId,
    kind: rumor.kind,
    expiration: expirations.length > 0 ? Math.min(...expirations) : undefined,
  };
}
