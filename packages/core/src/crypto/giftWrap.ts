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

/** Why `unwrapGiftWrap` refused a wrap. Every code is a final verdict on
 *  that wrap: the same bytes will fail the same way on every retry. */
export type GiftWrapRejectReason =
  | "expired"
  | "decrypt"
  | "malformed"
  | "seal_kind"
  | "seal_sig"
  | "kind"
  | "sender"
  | "rumor_id";

/**
 * Thrown by `unwrapGiftWrap` for a wrap it has judged and refused. Callers
 * that retry transient failures (a signer that is not ready, a bunker
 * round-trip that timed out — those surface as whatever the codec threw)
 * must NOT retry one of these: nothing about the wrap can change.
 */
export class GiftWrapRejectedError extends Error {
  readonly code: GiftWrapRejectReason;
  constructor(code: GiftWrapRejectReason, message: string) {
    super(message);
    this.name = "GiftWrapRejectedError";
    this.code = code;
  }
}

/**
 * A codec failure is retried only when it says the SIGNER was unavailable —
 * a timeout, a locked extension or keystore, a bunker that is away or has not
 * approved yet, no signer at all. Anything else (bad MAC, bad padding, wrong
 * version, truncated payload, whatever a vendor calls a wrong-key failure) is
 * a verdict on the wrap: retrying it would only spend a decrypt per NIP-77
 * round on bytes that will never change. An unknown message is therefore a
 * verdict, never a retry. Exported so a platform codec can test its own
 * messages against the same list.
 */
export function isTransientCodecFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timed? ?out|timeout|locked|not ready|not (yet )?available|unavailable|no signer|not logged in|not connected|disconnected|network|offline|busy|try again|rejected|denied|cancel+ed|not supported|doesn'?t support|unsupported by/i.test(
    msg,
  );
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
  /** Lifetime in seconds of the wrap, stamped as the wrap is built (after
   *  the seal is signed), so time spent queued behind the signer — a NIP-46
   *  bunker round-trips per call — does not eat it and a short-lived signal
   *  (§5) leaves with all of it. The seal gets `ttl` + SEAL_TTL_SLACK_SEC,
   *  stamped after its content is encrypted: it is inside the ciphertext,
   *  so only the receiver sees it, and the slack covers the signing wait
   *  for a receiver that judges expiry without a skew allowance. Takes
   *  precedence over `expiration`. */
  ttl?: number;
}

/** Extra lifetime of a `ttl` seal over its wrap: the signer timeout a NIP-46
 *  bunker is given, so the signing wait can never expire the seal first. */
export const SEAL_TTL_SLACK_SEC = 90;

/** The `expiration` tag for a seal or wrap built now. */
function expirationTagFor(opts?: WrapOptions, slackSec = 0): string[][] {
  if (opts?.ttl !== undefined) {
    return [["expiration", String(Math.floor(Date.now() / 1000) + Math.floor(opts.ttl) + slackSec)]];
  }
  if (opts?.expiration !== undefined) return [["expiration", String(Math.floor(opts.expiration))]];
  return [];
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
  // Encrypt rumor and create seal (kind:13) with the user's key
  const encryptedRumor = await ctx.signer.nip44Encrypt(sealTo, JSON.stringify(rumor));

  const sealUnsigned: UnsignedEvent = {
    pubkey: ctx.myPubkey,
    created_at: randomTimestamp(),
    kind: KIND_SEAL,
    // Stamped now, after the encrypt (which may have queued behind the
    // signer), with slack for the signing wait still ahead of it.
    tags: expirationTagFor(opts, SEAL_TTL_SLACK_SEC),
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
    // Stamped again after the seal was signed: the wrap is what relays sweep
    // and what the backend reads, so it leaves with its whole lifetime.
    tags: [["p", wrapTo], ...expirationTagFor(opts)],
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

/** Run the codec; a signer-unavailable failure propagates (retryable), every
 *  other failure is a `decrypt` verdict. */
async function decryptOrReject(
  codec: Pick<SignerAdapter, "nip44Decrypt">,
  peer: string,
  ciphertext: string,
): Promise<string> {
  try {
    return await codec.nip44Decrypt(peer, ciphertext);
  } catch (err) {
    if (err instanceof GiftWrapRejectedError) throw err;
    if (isTransientCodecFailure(err)) throw err;
    throw new GiftWrapRejectedError("decrypt", err instanceof Error ? err.message : "NIP-44 decrypt failed");
  }
}

function parseJsonOrReject<T>(json: string, message: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new GiftWrapRejectedError("malformed", message);
  }
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
 * inconsistency, tampered id) throws a `GiftWrapRejectedError` rather than
 * returning suspect plaintext. A failure of the codec itself (signer not
 * ready, bunker timeout) propagates as thrown, so callers can retry it.
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
    throw new GiftWrapRejectedError("expired", "Gift wrap expired");
  }

  // Step 2: Decrypt the gift wrap content using ephemeral pubkey
  const sealJson = await decryptOrReject(codec, giftWrapEvent.pubkey, giftWrapEvent.content);

  // Step 3: Parse + verify seal
  const seal = parseJsonOrReject<NostrEvent>(sealJson, "Seal is not JSON");
  if (!seal || typeof seal !== "object" || seal.kind !== KIND_SEAL) {
    throw new GiftWrapRejectedError("seal_kind", `Expected seal (kind:13), got kind:${seal?.kind}`);
  }
  if (opts?.verifySeal !== false) {
    if (
      typeof seal.id !== "string" ||
      typeof seal.sig !== "string" ||
      typeof seal.pubkey !== "string" ||
      !verifyEventSync(seal)
    ) {
      throw new GiftWrapRejectedError("seal_sig", "Seal signature invalid");
    }
  }
  const sealExpiration = expirationOf(seal.tags);
  if (sealExpiration !== undefined && sealExpiration <= now) {
    throw new GiftWrapRejectedError("expired", "Seal expired");
  }

  // Step 4: Decrypt seal content using seal's author pubkey
  const rumorJson = await decryptOrReject(codec, seal.pubkey, seal.content);

  // Step 5: Parse rumor
  const rumor = parseJsonOrReject<{
    id?: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  }>(rumorJson, "Rumor is not JSON");
  if (!rumor || typeof rumor !== "object") {
    throw new GiftWrapRejectedError("malformed", "Rumor is malformed");
  }

  // Validate rumor kind against the allowlist. Some NIP-07 extensions return
  // garbage on wrong-key decryption that can survive JSON.parse (e.g.
  // returning the seal itself as the "decrypted" content). Checking the kind
  // catches this: a seal (kind:13) mistakenly returned as a rumor fails here,
  // preventing its encrypted content from leaking through.
  if (typeof rumor.kind !== "number" || !acceptKinds.includes(rumor.kind)) {
    throw new GiftWrapRejectedError("kind", `Unsupported rumor kind:${rumor.kind}`);
  }

  // Shape checks — anchors and routing depend on these being well-formed.
  if (
    typeof rumor.pubkey !== "string" ||
    !HEX64_RE.test(rumor.pubkey) ||
    typeof rumor.created_at !== "number" ||
    typeof rumor.content !== "string" ||
    !Array.isArray(rumor.tags) ||
    !rumor.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === "string"))
  ) {
    throw new GiftWrapRejectedError("malformed", "Rumor is malformed");
  }

  // Verify sender consistency
  if (rumor.pubkey !== seal.pubkey) {
    throw new GiftWrapRejectedError("sender", "Rumor pubkey does not match seal pubkey");
  }

  // No content heuristics: a wrong key already fails the NIP-44 MAC above, the
  // seal signature, the kind gate and the id recompute below cover forgery. A
  // body that happens to be base64-shaped (an npub, a hex id, a long laugh) is
  // a message like any other.

  // Recompute the rumor id: a sealer must not be able to choose the anchor
  // other messages (edits, deletes, reactions) will point at.
  const computedId = getEventId(rumor);
  if (rumor.id !== undefined && rumor.id !== computedId) {
    throw new GiftWrapRejectedError("rumor_id", "Rumor id mismatch");
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
