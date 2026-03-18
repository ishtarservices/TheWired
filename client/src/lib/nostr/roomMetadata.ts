import { EVENT_KINDS } from "@/types/nostr";
import type { UnsignedEvent } from "@/types/nostr";
import { signAndPublish } from "./publish";
import { store } from "@/store";

/** Room metadata for kind:30312 Interactive Room */
export interface RoomMetadata {
  roomId: string;
  spaceId: string;
  name: string;
  serviceUrl: string;
  status: "open" | "private" | "closed";
  hostPubkeys: string[];
  moderatorPubkeys: string[];
  relays: string[];
  currentParticipants: number;
}

/**
 * Publish a kind:30312 Interactive Room event (NIP-53).
 * This creates or updates a voice/video room definition.
 */
export async function publishRoomMetadata(
  metadata: RoomMetadata,
): Promise<void> {
  const tags: string[][] = [
    ["d", metadata.roomId],
    ["h", metadata.spaceId],
    ["room", metadata.name],
    ["service", metadata.serviceUrl],
    ["status", metadata.status],
    ["current_participants", String(metadata.currentParticipants)],
  ];

  for (const host of metadata.hostPubkeys) {
    tags.push(["p", host, "", "host"]);
  }
  for (const mod of metadata.moderatorPubkeys) {
    tags.push(["p", mod, "", "moderator"]);
  }
  for (const relay of metadata.relays) {
    tags.push(["relays", relay]);
  }

  const unsigned: UnsignedEvent = {
    pubkey: store.getState().identity.pubkey!,
    created_at: Math.round(Date.now() / 1000),
    kind: EVENT_KINDS.INTERACTIVE_ROOM,
    tags,
    content: "",
  };

  await signAndPublish(unsigned);
}

/**
 * Parse a kind:30312 event into RoomMetadata.
 */
export function parseRoomMetadata(event: {
  pubkey: string;
  tags: string[][];
  content: string;
}): RoomMetadata | null {
  const roomId = event.tags.find((t) => t[0] === "d")?.[1];
  const spaceId = event.tags.find((t) => t[0] === "h")?.[1];
  if (!roomId || !spaceId) return null;

  const hostPubkeys = event.tags
    .filter((t) => t[0] === "p" && t[3] === "host")
    .map((t) => t[1]);

  const moderatorPubkeys = event.tags
    .filter((t) => t[0] === "p" && t[3] === "moderator")
    .map((t) => t[1]);

  const relays = event.tags
    .filter((t) => t[0] === "relays")
    .map((t) => t[1]);

  return {
    roomId,
    spaceId,
    name: event.tags.find((t) => t[0] === "room")?.[1] ?? "",
    serviceUrl: event.tags.find((t) => t[0] === "service")?.[1] ?? "",
    status: (event.tags.find((t) => t[0] === "status")?.[1] as "open" | "private" | "closed") ?? "open",
    hostPubkeys,
    moderatorPubkeys,
    relays,
    currentParticipants: parseInt(event.tags.find((t) => t[0] === "current_participants")?.[1] ?? "0", 10),
  };
}
