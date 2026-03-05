import { useEffect, useState, useMemo } from "react";
import { useAppSelector } from "../../store/hooks";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { buildProfileFeedFilter, buildProfileArticlesFilter } from "../../lib/nostr/filterBuilder";
import { parseThreadRef } from "../spaces/noteParser";
import { hasMediaUrls } from "../../lib/media/mediaUrlParser";
import { matchEmbed } from "../../lib/content/embedPatterns";
import { parseLongFormEvent } from "../longform/useLongForm";
import type { NostrEvent } from "../../types/nostr";
import type { LongFormArticle } from "../../types/media";

export interface ProfileFeedItem {
  event: NostrEvent;
  /** If this is a repost (kind:6), the target event ID */
  repostedEventId: string | null;
  /** The pubkey of the reposter (only set for reposts) */
  reposterPubkey: string | null;
}

/** Check if content contains any embeddable URLs */
function hasEmbedUrls(content: string): boolean {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
  for (const match of content.matchAll(urlRegex)) {
    if (matchEmbed(match[0])) return true;
  }
  return false;
}

/**
 * Profile feed hook — subscribes for kind:1, kind:6, and kind:30023.
 * Returns filtered views: allItems, rootNotes, replies, mediaItems, articles.
 */
export function useProfileFeed(pubkey: string) {
  const [eoseReceived, setEoseReceived] = useState(false);
  const [articlesEose, setArticlesEose] = useState(false);

  useEffect(() => {
    setEoseReceived(false);
    setArticlesEose(false);

    const feedSubId = subscriptionManager.subscribe({
      filters: [buildProfileFeedFilter(pubkey)],
      onEOSE: () => setEoseReceived(true),
    });

    const articlesSubId = subscriptionManager.subscribe({
      filters: [buildProfileArticlesFilter(pubkey)],
      onEOSE: () => setArticlesEose(true),
    });

    return () => {
      subscriptionManager.close(feedSubId);
      subscriptionManager.close(articlesSubId);
    };
  }, [pubkey]);

  const noteIds = useAppSelector((s) => s.events.notesByAuthor[pubkey]);
  const repostIds = useAppSelector((s) => s.events.repostsByAuthor[pubkey]);
  const longformIds = useAppSelector((s) => s.events.longform["global"]);
  const entities = useAppSelector((s) => s.events.entities);

  // Build all feed items (notes + reposts) sorted by created_at desc
  const allItems = useMemo(() => {
    const items: ProfileFeedItem[] = [];

    // Add notes
    if (noteIds) {
      for (const id of noteIds) {
        const event = entities[id];
        if (event && event.pubkey === pubkey) {
          items.push({ event, repostedEventId: null, reposterPubkey: null });
        }
      }
    }

    // Add reposts
    if (repostIds) {
      for (const id of repostIds) {
        const event = entities[id];
        if (event && event.kind === 6) {
          const targetId = event.tags.find((t) => t[0] === "e")?.[1] ?? null;
          items.push({
            event,
            repostedEventId: targetId,
            reposterPubkey: event.pubkey,
          });
        }
      }
    }

    items.sort((a, b) => b.event.created_at - a.event.created_at);
    return items;
  }, [noteIds, repostIds, entities, pubkey]);

  // Root notes only (kind:1 with no thread root, NO reposts)
  const rootNotes = useMemo(() => {
    return allItems.filter((item) => {
      if (item.repostedEventId) return false;
      if (item.event.kind !== 1) return false;
      const ref = parseThreadRef(item.event);
      return ref.rootId === null;
    });
  }, [allItems]);

  // Reposts only (kind:6)
  const reposts = useMemo(() => {
    return allItems.filter((item) => !!item.repostedEventId);
  }, [allItems]);

  // Replies only (kind:1 with thread root ref)
  const replies = useMemo(() => {
    return allItems.filter((item) => {
      if (item.event.kind !== 1) return false;
      const ref = parseThreadRef(item.event);
      return ref.rootId !== null;
    });
  }, [allItems]);

  // Media items (notes containing image/video URLs or embed URLs)
  const mediaItems = useMemo(() => {
    return allItems.filter((item) => {
      if (item.repostedEventId) return false; // skip reposts for media tab
      if (item.event.kind !== 1) return false;
      return hasMediaUrls(item.event.content) || hasEmbedUrls(item.event.content);
    });
  }, [allItems]);

  // Articles (kind:30023)
  const articles = useMemo((): LongFormArticle[] => {
    if (!longformIds) return [];
    return longformIds
      .map((id) => entities[id])
      .filter((e): e is NostrEvent => !!e && e.pubkey === pubkey)
      .sort((a, b) => b.created_at - a.created_at)
      .map(parseLongFormEvent);
  }, [longformIds, entities, pubkey]);

  const loading = allItems.length === 0 && !eoseReceived;

  return {
    allItems,
    rootNotes,
    reposts,
    replies,
    mediaItems,
    articles,
    loading,
    eoseReceived,
    articlesEose,
  };
}

/** @deprecated Use useProfileFeed instead */
export function useProfileNotes(pubkey: string) {
  const { allItems, loading, eoseReceived } = useProfileFeed(pubkey);
  const notes = useMemo(
    () => allItems.filter((i) => !i.repostedEventId).map((i) => i.event),
    [allItems],
  );
  return { notes, loading, eoseReceived };
}
