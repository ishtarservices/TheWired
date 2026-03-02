import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { getConversationKey, encrypt } from "nostr-tools/nip44";
import { nip44Encrypt, nip44Decrypt } from "./nip44";
import { getSigner } from "./loginFlow";
import { store } from "@/store";
import { EVENT_KINDS } from "@/types/nostr";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";

const TWO_DAYS = 2 * 24 * 60 * 60;

function randomTimestamp(): number {
  return Math.round(Date.now() / 1000 - Math.random() * TWO_DAYS);
}

/** Async event ID computation via Web Crypto SHA-256 */
async function getEventId(event: {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}): Promise<string> {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(serialized));
  const arr = new Uint8Array(buf);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface UnwrappedDM {
  sender: string;
  content: string;
  tags: string[][];
  createdAt: number;
  wrapId: string;
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
 * Returns the gift wrap event ready to publish.
 */
export async function createGiftWrappedDM(
  content: string,
  recipientPubkey: string,
  extraTags?: string[][],
): Promise<NostrEvent> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  // Step 1: Build rumor (unsigned kind:14, never published)
  const rumorTags: string[][] = [["p", recipientPubkey]];
  if (extraTags) rumorTags.push(...extraTags);

  const rumor = {
    pubkey: myPubkey,
    created_at: randomTimestamp(),
    kind: EVENT_KINDS.DM_MESSAGE,
    tags: rumorTags,
    content,
  };
  const rumorId = await getEventId(rumor);
  const rumorWithId = { ...rumor, id: rumorId };

  // Step 2: Encrypt rumor and create seal (kind:13)
  const encryptedRumor = await nip44Encrypt(
    recipientPubkey,
    JSON.stringify(rumorWithId),
  );

  const sealUnsigned: UnsignedEvent = {
    pubkey: myPubkey,
    created_at: randomTimestamp(),
    kind: EVENT_KINDS.SEAL,
    tags: [],
    content: encryptedRumor,
  };

  const seal = await signer.signEvent(sealUnsigned);

  // Step 3: Generate ephemeral keypair
  const ephemeralSk = generateSecretKey();
  const ephemeralPk = getPublicKey(ephemeralSk);

  // Step 4: Encrypt seal with ephemeral key → recipient
  const conversationKey = getConversationKey(ephemeralSk, recipientPubkey);
  const encryptedSeal = encrypt(JSON.stringify(seal), conversationKey);

  // Step 5: Build and sign gift wrap with ephemeral key
  const wrapEvent = {
    pubkey: ephemeralPk,
    created_at: randomTimestamp(),
    kind: EVENT_KINDS.GIFT_WRAP,
    tags: [["p", recipientPubkey]],
    content: encryptedSeal,
  };

  // Sign with ephemeral key using nostr-tools finalizeEvent
  const signedWrap = finalizeEvent(wrapEvent, ephemeralSk);

  return signedWrap as unknown as NostrEvent;
}

/**
 * Create a gift-wrapped DM to self (so sender can see their own messages).
 * Same as createGiftWrappedDM but wraps to self instead of recipient.
 */
export async function createSelfWrap(
  content: string,
  recipientPubkey: string,
  extraTags?: string[][],
): Promise<NostrEvent> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  const rumorTags: string[][] = [["p", recipientPubkey]];
  if (extraTags) rumorTags.push(...extraTags);

  const rumor = {
    pubkey: myPubkey,
    created_at: randomTimestamp(),
    kind: EVENT_KINDS.DM_MESSAGE,
    tags: rumorTags,
    content,
  };
  const rumorId = await getEventId(rumor);
  const rumorWithId = { ...rumor, id: rumorId };

  // Encrypt rumor to self
  const encryptedRumor = await nip44Encrypt(
    myPubkey,
    JSON.stringify(rumorWithId),
  );

  const sealUnsigned: UnsignedEvent = {
    pubkey: myPubkey,
    created_at: randomTimestamp(),
    kind: EVENT_KINDS.SEAL,
    tags: [],
    content: encryptedRumor,
  };

  const seal = await signer.signEvent(sealUnsigned);

  // Ephemeral key
  const ephemeralSk = generateSecretKey();
  const ephemeralPk = getPublicKey(ephemeralSk);

  // Encrypt seal to self
  const conversationKey = getConversationKey(ephemeralSk, myPubkey);
  const encryptedSeal = encrypt(JSON.stringify(seal), conversationKey);

  const wrapEvent = {
    pubkey: ephemeralPk,
    created_at: randomTimestamp(),
    kind: EVENT_KINDS.GIFT_WRAP,
    tags: [["p", myPubkey]],
    content: encryptedSeal,
  };

  const signedWrap = finalizeEvent(wrapEvent, ephemeralSk);
  return signedWrap as unknown as NostrEvent;
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
 */
export async function unwrapGiftWrap(
  giftWrapEvent: NostrEvent,
): Promise<UnwrappedDM> {
  // Step 1: Decrypt the gift wrap content using ephemeral pubkey
  const sealJson = await nip44Decrypt(
    giftWrapEvent.pubkey,
    giftWrapEvent.content,
  );

  // Step 2: Parse seal
  const seal = JSON.parse(sealJson) as NostrEvent;
  if (seal.kind !== EVENT_KINDS.SEAL) {
    throw new Error(`Expected seal (kind:13), got kind:${seal.kind}`);
  }

  // Step 3: Decrypt seal content using seal's author pubkey
  const rumorJson = await nip44Decrypt(seal.pubkey, seal.content);

  // Step 4: Parse rumor
  const rumor = JSON.parse(rumorJson) as {
    id?: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  };

  // Verify sender consistency
  if (rumor.pubkey !== seal.pubkey) {
    throw new Error("Rumor pubkey does not match seal pubkey");
  }

  return {
    sender: seal.pubkey,
    content: rumor.content,
    tags: rumor.tags,
    createdAt: rumor.created_at,
    wrapId: giftWrapEvent.id,
  };
}
