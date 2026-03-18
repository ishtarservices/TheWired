import { EVENT_KINDS } from "@/types/nostr";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";
import type { LiveChatMessage } from "@/types/calling";
import { signAndPublish } from "./publish";
import { store } from "@/store";

/**
 * Publish a kind:1311 Live Chat message in a voice room (NIP-53).
 */
export async function publishLiveChat(
  roomRef: string,
  content: string,
): Promise<void> {
  const unsigned: UnsignedEvent = {
    pubkey: store.getState().identity.pubkey!,
    created_at: Math.round(Date.now() / 1000),
    kind: EVENT_KINDS.LIVE_CHAT,
    tags: [["a", roomRef]],
    content,
  };

  await signAndPublish(unsigned);
}

/**
 * Parse a kind:1311 event into a LiveChatMessage.
 */
export function parseLiveChatMessage(event: NostrEvent): LiveChatMessage | null {
  const roomRef = event.tags.find((t) => t[0] === "a")?.[1];
  if (!roomRef) return null;

  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    roomRef,
    createdAt: event.created_at,
  };
}
