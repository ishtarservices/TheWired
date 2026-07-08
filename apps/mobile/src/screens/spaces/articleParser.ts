// Articles-channel parsing: kind 30023 (NIP-23 long-form) → card data +
// the naddr the Article screen expects. Pure + tested.

import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

export interface ArticleItem {
  id: string;
  event: NostrEvent;
  dTag: string;
  title: string;
  summary: string | null;
  /** https cover image, if any. */
  image: string | null;
  /** published_at tag (unix seconds) falling back to created_at. */
  publishedAt: number;
}

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((t) => t[0] === name)?.[1];
}

export function parseArticleEvent(event: NostrEvent): ArticleItem | null {
  if (event.kind !== 30023) return null;
  const dTag = tagValue(event, "d");
  if (dTag === undefined) return null;

  const image = tagValue(event, "image");
  const publishedRaw = Number.parseInt(tagValue(event, "published_at") ?? "", 10);

  return {
    id: event.id,
    event,
    dTag,
    title: tagValue(event, "title")?.trim() || "Untitled",
    summary: tagValue(event, "summary")?.trim() || null,
    image: image && /^https:\/\//i.test(image) ? image : null,
    publishedAt: Number.isFinite(publishedRaw) && publishedRaw > 0 ? publishedRaw : event.created_at,
  };
}

export function parseArticleEvents(events: NostrEvent[]): ArticleItem[] {
  const out: ArticleItem[] = [];
  for (const event of events) {
    const item = parseArticleEvent(event);
    if (item) out.push(item);
  }
  return out;
}

/** naddr for the root Article screen. Relay hint only when we have one. */
export function articleNaddr(item: ArticleItem, relayHint?: string | null): string {
  return nip19.naddrEncode({
    identifier: item.dTag,
    pubkey: item.event.pubkey,
    kind: 30023,
    ...(relayHint ? { relays: [relayHint] } : {}),
  });
}
