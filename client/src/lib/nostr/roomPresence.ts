import { EVENT_KINDS } from "@/types/nostr";
import type { UnsignedEvent } from "@/types/nostr";
import type { RoomPresence } from "@/types/calling";
import { signAndPublish } from "./publish";
import { store } from "@/store";

/**
 * Publish a kind:10312 Room Presence event (NIP-53).
 *
 * This is a replaceable event — only one per user per room.
 * Publishing presence to a new room automatically replaces the old one.
 */
export async function publishRoomPresence(
  roomRef: string,
  options: { handRaised?: boolean; muted?: boolean } = {},
): Promise<void> {
  const tags: string[][] = [
    ["a", roomRef],
  ];

  if (options.handRaised) {
    tags.push(["hand", "1"]);
  }
  if (options.muted) {
    tags.push(["muted", "1"]);
  }

  const unsigned: UnsignedEvent = {
    pubkey: store.getState().identity.pubkey!,
    created_at: Math.round(Date.now() / 1000),
    kind: EVENT_KINDS.ROOM_PRESENCE,
    tags,
    content: "",
  };

  await signAndPublish(unsigned);
}

/**
 * Publish an empty presence event to indicate leaving a room.
 * Since kind:10312 is replaceable, this effectively clears presence.
 */
export async function clearRoomPresence(): Promise<void> {
  const unsigned: UnsignedEvent = {
    pubkey: store.getState().identity.pubkey!,
    created_at: Math.round(Date.now() / 1000),
    kind: EVENT_KINDS.ROOM_PRESENCE,
    tags: [],
    content: "",
  };

  await signAndPublish(unsigned);
}

/**
 * Parse a kind:10312 event into a RoomPresence object.
 */
export function parseRoomPresence(event: {
  pubkey: string;
  tags: string[][];
  created_at: number;
}): RoomPresence | null {
  const roomRef = event.tags.find((t) => t[0] === "a")?.[1];
  if (!roomRef) return null;

  return {
    pubkey: event.pubkey,
    roomRef,
    handRaised: event.tags.some((t) => t[0] === "hand" && t[1] === "1"),
    muted: event.tags.some((t) => t[0] === "muted" && t[1] === "1"),
    createdAt: event.created_at,
  };
}
