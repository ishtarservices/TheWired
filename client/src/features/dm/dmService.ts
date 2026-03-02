import { createGiftWrappedDM, createSelfWrap } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { store } from "@/store";
import { addDMMessage } from "@/store/slices/dmSlice";

/**
 * Send a DM to a recipient.
 * Creates two gift wraps: one for the recipient and one for the sender (self).
 * Publishes both to write relays.
 */
export async function sendDM(
  recipientPubkey: string,
  content: string,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  // Validate pubkey format (64 hex characters)
  if (!/^[0-9a-f]{64}$/i.test(recipientPubkey)) {
    throw new Error("Invalid recipient pubkey format. Must be a 64-character hex string.");
  }

  // Check that write relays are available before doing expensive encryption
  if (relayManager.getWriteRelays().length === 0) {
    throw new Error("No write relays connected. Please check your connection and try again.");
  }

  // Create gift wrap for recipient
  const recipientWrap = await createGiftWrappedDM(content, recipientPubkey);

  // Create gift wrap for self (so we see our own messages)
  const selfWrap = await createSelfWrap(content, recipientPubkey);

  // Publish both — check that at least one relay received them
  const sent = relayManager.publish(recipientWrap);
  relayManager.publish(selfWrap);

  if (sent === 0) {
    throw new Error("Failed to publish DM: no write relays available.");
  }

  // Optimistic local display with real timestamp (not the randomized rumor timestamp).
  // The self-wrap arriving from relays later will be deduped by wrapId.
  store.dispatch(
    addDMMessage({
      partnerPubkey: recipientPubkey,
      myPubkey,
      message: {
        id: selfWrap.id,
        senderPubkey: myPubkey,
        content,
        createdAt: Math.round(Date.now() / 1000),
        wrapId: selfWrap.id,
      },
    }),
  );
}
