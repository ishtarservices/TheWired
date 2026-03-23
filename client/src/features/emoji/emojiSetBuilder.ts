import type { UnsignedEvent } from "@/types/nostr";
import type { CustomEmoji } from "@/types/emoji";

/** Build an unsigned kind:30030 emoji set event (NIP-30) */
export function buildEmojiSetEvent(
  pubkey: string,
  dTag: string,
  title: string,
  emojis: CustomEmoji[],
  spaceId?: string,
): UnsignedEvent {
  const tags: string[][] = [["d", dTag]];

  if (title) {
    tags.push(["title", title]);
  }

  // Scope to space if provided
  if (spaceId) {
    tags.push(["h", spaceId]);
  }

  // Add emoji tags
  for (const emoji of emojis) {
    const tag = ["emoji", emoji.shortcode, emoji.url];
    if (emoji.setAddress) {
      tag.push(emoji.setAddress);
    }
    tags.push(tag);
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 30030,
    tags,
    content: "",
  };
}

/** Build an unsigned kind:10030 user emoji list event (NIP-51) */
export function buildUserEmojiListEvent(
  pubkey: string,
  emojis: CustomEmoji[],
  setRefs?: string[],
): UnsignedEvent {
  const tags: string[][] = [];

  // Add emoji tags
  for (const emoji of emojis) {
    tags.push(["emoji", emoji.shortcode, emoji.url]);
  }

  // Add set references (addressable IDs pointing to kind:30030 events)
  if (setRefs) {
    for (const ref of setRefs) {
      tags.push(["a", ref]);
    }
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 10030,
    tags,
    content: "",
  };
}
