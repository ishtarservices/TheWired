import { nip19 } from "nostr-tools";
import { createGiftWrappedDM, createSelfWrap, buildRumor } from "@/lib/nostr/giftWrap";
import { relayManager } from "@/lib/nostr/relayManager";
import { getDMRelaysForPublish, getOwnDMRelays } from "@/lib/nostr/dmRelayList";
import { store } from "@/store";
import { addDMMessage, editDMMessage, remoteDeleteDMMessage } from "@/store/slices/dmSlice";

/** 15 minutes in seconds */
const EDIT_WINDOW_SECONDS = 15 * 60;

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
 * Both wraps share the same rumor so the rumorId is consistent for edits/deletes.
 * Publishes both to write relays.
 */
export async function sendDM(
  recipientPubkey: string,
  content: string,
  replyTo?: { wrapId: string },
  emojiTags?: string[][],
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  // Resolve npub or hex to a 64-char hex pubkey
  recipientPubkey = resolveHexPubkey(recipientPubkey);

  // Check that write relays are available before doing expensive encryption
  if (relayManager.getWriteRelays().length === 0) {
    throw new Error("No write relays connected. Please check your connection and try again.");
  }

  // Build extra tags for reply + emoji
  const extraTags: string[][] = [];
  if (replyTo) extraTags.push(["q", replyTo.wrapId]);
  if (emojiTags) extraTags.push(...emojiTags);

  // Build one shared rumor so both wraps have the same rumorId.
  // This is critical for edit/delete to work: the "e" tag in an edit/delete
  // wrap references this rumorId, and both sender and recipient need to store
  // the same value.
  const sharedRumor = await buildRumor(myPubkey, recipientPubkey, content, extraTags.length > 0 ? extraTags : undefined);

  // Create recipient wrap and self wrap using the shared rumor
  const { wrap: recipientWrap } = await createGiftWrappedDM(content, recipientPubkey, extraTags, sharedRumor);
  const { wrap: selfWrap } = await createSelfWrap(content, recipientPubkey, extraTags, sharedRumor);
  const rumorId = sharedRumor.id;

  // Publish to recipient's DM relays (falls back to all write relays)
  const recipientRelays = await getDMRelaysForPublish(recipientPubkey);
  const sent = relayManager.publish(recipientWrap, recipientRelays);

  // Publish self-wrap to our own DM relays (falls back to all write relays)
  const ownRelays = getOwnDMRelays();
  const selfSent = relayManager.publish(selfWrap, ownRelays.length > 0 ? ownRelays : undefined);

  if (sent === 0) {
    throw new Error("Failed to publish DM: no write relays available.");
  }

  if (selfSent === 0) {
    console.warn("Self-wrap publish failed — message won't sync to other devices");
  }

  // Optimistic local display using the rumor's real created_at for consistency.
  // The self-wrap arriving from relays later will be deduped by wrapId.
  // Use the recipient wrap's rumorId — this is what the recipient will store,
  // so edits/deletes using this ID will match on both sides.
  store.dispatch(
    addDMMessage({
      partnerPubkey: recipientPubkey,
      myPubkey,
      message: {
        id: selfWrap.id,
        senderPubkey: myPubkey,
        content,
        createdAt: sharedRumor.created_at,
        wrapId: selfWrap.id,
        rumorId,
        replyToWrapId: replyTo?.wrapId,
        emojiTags: emojiTags && emojiTags.length > 0 ? emojiTags : undefined,
      },
    }),
  );
}

/**
 * Edit a DM message by sending a new gift-wrapped message with type "dm_edit".
 * Both sender and recipient receive the edit.
 */
export async function editDM(
  partnerPubkey: string,
  originalRumorId: string,
  newContent: string,
  originalCreatedAt: number,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  // Client-enforced 15-minute edit window
  const age = Math.floor(Date.now() / 1000) - originalCreatedAt;
  if (age > EDIT_WINDOW_SECONDS) throw new Error("Edit window has expired");

  partnerPubkey = resolveHexPubkey(partnerPubkey);

  const extraTags: string[][] = [
    ["type", "dm_edit"],
    ["e", originalRumorId],
  ];

  // Build shared rumor for both wraps
  const sharedRumor = await buildRumor(myPubkey, partnerPubkey, newContent, extraTags);

  // Send to recipient
  const { wrap: recipientWrap } = await createGiftWrappedDM(newContent, partnerPubkey, extraTags, sharedRumor);
  const recipientRelays = await getDMRelaysForPublish(partnerPubkey);
  relayManager.publish(recipientWrap, recipientRelays);

  // Send to self
  const { wrap: selfWrap } = await createSelfWrap(newContent, partnerPubkey, extraTags, sharedRumor);
  const ownRelays = getOwnDMRelays();
  relayManager.publish(selfWrap, ownRelays.length > 0 ? ownRelays : undefined);

  // Optimistic local update
  store.dispatch(
    editDMMessage({
      partnerPubkey,
      rumorId: originalRumorId,
      newContent,
      editedAt: Math.round(Date.now() / 1000),
    }),
  );
}

/**
 * Delete a DM message for everyone by sending a gift-wrapped message with type "dm_delete".
 */
export async function deleteDMForEveryone(
  partnerPubkey: string,
  originalRumorId: string,
): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) throw new Error("Not logged in");

  partnerPubkey = resolveHexPubkey(partnerPubkey);

  const extraTags: string[][] = [
    ["type", "dm_delete"],
    ["e", originalRumorId],
  ];

  // Build shared rumor for both wraps
  const sharedRumor = await buildRumor(myPubkey, partnerPubkey, "", extraTags);

  // Send to recipient
  const { wrap: recipientWrap } = await createGiftWrappedDM("", partnerPubkey, extraTags, sharedRumor);
  const recipientRelays = await getDMRelaysForPublish(partnerPubkey);
  relayManager.publish(recipientWrap, recipientRelays);

  // Send to self
  const { wrap: selfWrap } = await createSelfWrap("", partnerPubkey, extraTags, sharedRumor);
  const ownRelays = getOwnDMRelays();
  relayManager.publish(selfWrap, ownRelays.length > 0 ? ownRelays : undefined);

  // Optimistic local update
  store.dispatch(
    remoteDeleteDMMessage({
      partnerPubkey,
      rumorId: originalRumorId,
    }),
  );
}
