import { nip19 } from "nostr-tools";
import { createGiftWrappedDM, createSelfWrap } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, getOwnDMRelays } from "@/lib/nostr/dmRelayList";
import { store } from "@/store";
import { addDMMessage } from "@/store/slices/dmSlice";

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

  // Resolve npub or hex to a 64-char hex pubkey
  recipientPubkey = resolveHexPubkey(recipientPubkey);

  // Check that write relays are available before doing expensive encryption
  if (relayManager.getWriteRelays().length === 0) {
    throw new Error("No write relays connected. Please check your connection and try again.");
  }

  // Create gift wrap for recipient
  const recipientWrap = await createGiftWrappedDM(content, recipientPubkey);

  // Create gift wrap for self (so we see our own messages)
  const selfWrap = await createSelfWrap(content, recipientPubkey);

  // Publish to recipient's DM relays (falls back to all write relays)
  const recipientRelays = await getDMRelaysForPublish(recipientPubkey);
  const sent = relayManager.publish(recipientWrap, recipientRelays);

  // Publish self-wrap to our own DM relays (falls back to all write relays)
  const ownRelays = getOwnDMRelays();
  relayManager.publish(selfWrap, ownRelays.length > 0 ? ownRelays : undefined);

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
