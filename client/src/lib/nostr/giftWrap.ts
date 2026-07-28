// NIP-17/NIP-59 gift-wrap crypto moved to @thewired/core (Phase 0). This shim
// keeps the original module API (signer + pubkey resolved implicitly from the
// login flow / Redux) so call sites don't churn; the core functions take an
// explicit GiftWrapContext instead.
//
// Queueing contract preserved: seal signing goes through the signingQueue here,
// and the nip44 dispatch shim (./nip44) enqueues its own signer calls.

import {
  buildRumor as coreBuildRumor,
  createGiftWrappedDM as coreCreateGiftWrappedDM,
  createSelfWrap as coreCreateSelfWrap,
  unwrapGiftWrap as coreUnwrapGiftWrap,
  type GiftWrapContext,
  type Rumor,
  type UnwrappedDM,
  type GiftWrapResult,
} from "@thewired/core";
import { nip44Encrypt, nip44Decrypt } from "./nip44";
import { getSigner } from "./loginFlow";
import { signingQueue } from "./signingQueue";
import { store } from "@/store";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";

export type { UnwrappedDM, GiftWrapResult, Rumor };

/** Resolve the active signer + pubkey into the core GiftWrapContext. */
function giftWrapContext(): GiftWrapContext {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  return {
    myPubkey,
    signer: {
      getPublicKey: () => Promise.resolve(myPubkey),
      signEvent: (unsigned: UnsignedEvent) =>
        signingQueue.enqueue(() => signer.signEvent(unsigned)),
      nip44Encrypt,
      nip44Decrypt,
    },
  };
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
  return coreBuildRumor(myPubkey, recipientPubkey, content, extraTags);
}

/** Create a NIP-17 gift-wrapped DM (see @thewired/core for the full flow). */
export async function createGiftWrappedDM(
  content: string,
  recipientPubkey: string,
  extraTags?: string[][],
  /** Pre-built rumor to reuse (for shared ID between recipient + self wrap) */
  sharedRumor?: Rumor,
): Promise<GiftWrapResult> {
  return coreCreateGiftWrappedDM(giftWrapContext(), content, recipientPubkey, extraTags, sharedRumor);
}

/**
 * Create a gift-wrapped DM to self (so sender can see their own messages).
 * Uses the same rumor as the recipient wrap for a shared ID.
 */
export async function createSelfWrap(
  content: string,
  recipientPubkey: string,
  extraTags?: string[][],
  /** Pre-built rumor to reuse (for shared ID between recipient + self wrap) */
  sharedRumor?: Rumor,
): Promise<GiftWrapResult> {
  return coreCreateSelfWrap(giftWrapContext(), content, recipientPubkey, extraTags, sharedRumor);
}

/** Unwrap a received gift wrap event (kind:1059) with the active signer. */
export async function unwrapGiftWrap(giftWrapEvent: NostrEvent): Promise<UnwrappedDM> {
  return coreUnwrapGiftWrap({ nip44Decrypt }, giftWrapEvent);
}
