import type { NostrEvent } from "@/types/nostr";
import type { CustomEmoji, EmojiSet } from "@/types/emoji";

/** Parse a kind:30030 emoji set event into an EmojiSet */
export function parseEmojiSetEvent(event: NostrEvent): EmojiSet {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const title = event.tags.find((t) => t[0] === "title")?.[1];
  const image = event.tags.find((t) => t[0] === "image")?.[1];
  const description = event.tags.find((t) => t[0] === "description")?.[1];

  const emojis: CustomEmoji[] = [];
  for (const tag of event.tags) {
    if (tag[0] === "emoji" && tag[1] && tag[2]) {
      emojis.push({
        shortcode: tag[1],
        url: tag[2],
        setAddress: tag[3],
      });
    }
  }

  return {
    addressableId: `30030:${event.pubkey}:${dTag}`,
    pubkey: event.pubkey,
    dTag,
    title,
    image,
    description,
    emojis,
    createdAt: event.created_at,
    eventId: event.id,
  };
}

/** Parse a kind:10030 user emoji list event */
export function parseUserEmojiListEvent(event: NostrEvent): {
  emojis: CustomEmoji[];
  setRefs: string[];
} {
  const emojis: CustomEmoji[] = [];
  const setRefs: string[] = [];

  for (const tag of event.tags) {
    if (tag[0] === "emoji" && tag[1] && tag[2]) {
      emojis.push({
        shortcode: tag[1],
        url: tag[2],
        setAddress: tag[3],
      });
    } else if (tag[0] === "a" && tag[1]?.startsWith("30030:")) {
      setRefs.push(tag[1]);
    }
  }

  return { emojis, setRefs };
}
