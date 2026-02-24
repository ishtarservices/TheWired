import type { NostrEvent } from "../../types/nostr";
import type { LongFormArticle } from "../../types/media";

/** Parse a kind:30023 long-form event */
export function parseLongFormEvent(event: NostrEvent): LongFormArticle {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  const title = event.tags.find((t) => t[0] === "title")?.[1] ?? "Untitled";
  const summary = event.tags.find((t) => t[0] === "summary")?.[1];
  const image = event.tags.find((t) => t[0] === "image")?.[1];
  const publishedAtStr = event.tags.find((t) => t[0] === "published_at")?.[1];
  const publishedAt = publishedAtStr ? parseInt(publishedAtStr, 10) : undefined;
  const hashtags = event.tags
    .filter((t) => t[0] === "t" && t[1])
    .map((t) => t[1]);

  return {
    eventId: event.id,
    pubkey: event.pubkey,
    dTag,
    title,
    summary,
    image,
    publishedAt,
    content: event.content,
    hashtags,
  };
}
