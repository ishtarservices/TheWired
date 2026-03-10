import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { shallowEqual } from "react-redux";
import { useAppSelector } from "../../store/hooks";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
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

/** Page size for paginated feed rendering */
const PAGE_SIZE = 20;

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
 * Returns filtered views with pagination support.
 */
export function useProfileFeed(pubkey: string) {
  const [eoseReceived, setEoseReceived] = useState(false);
  const [articlesEose, setArticlesEose] = useState(false);

  // Pagination state per tab
  const [notesPage, setNotesPage] = useState(1);
  const [repostsPage, setRepostsPage] = useState(1);
  const [repliesPage, setRepliesPage] = useState(1);
  const [mediaPage, setMediaPage] = useState(1);
  const [articlesPage, setArticlesPage] = useState(1);

  // Track oldest event timestamp for relay pagination
  const oldestTimestampRef = useRef<number>(0);
  const [fetchingMore, setFetchingMore] = useState(false);

  // Reset pagination when pubkey changes
  useEffect(() => {
    setNotesPage(1);
    setRepostsPage(1);
    setRepliesPage(1);
    setMediaPage(1);
    setArticlesPage(1);
    oldestTimestampRef.current = 0;
  }, [pubkey]);

  useEffect(() => {
    setEoseReceived(false);
    setArticlesEose(false);

    const feedSubId = subscriptionManager.subscribe({
      filters: [{ kinds: [1, 6], authors: [pubkey], limit: 50 }],
      onEOSE: () => setEoseReceived(true),
    });

    const articlesSubId = subscriptionManager.subscribe({
      filters: [{ kinds: [30023], authors: [pubkey], limit: 20 }],
      onEOSE: () => setArticlesEose(true),
    });

    return () => {
      subscriptionManager.close(feedSubId);
      subscriptionManager.close(articlesSubId);
    };
  }, [pubkey]);

  // --- Targeted selectors (avoid selecting entire entities dict) ---
  const noteIds = useAppSelector(
    (s) => s.events.notesByAuthor[pubkey],
    shallowEqual,
  );
  const repostIds = useAppSelector(
    (s) => s.events.repostsByAuthor[pubkey],
    shallowEqual,
  );
  const longformIds = useAppSelector(
    (s) => s.events.longform["global"],
    shallowEqual,
  );

  // Select only the events we actually need, not the entire entities dict
  const noteEvents = useAppSelector((s) => {
    if (!noteIds) return null;
    const result: Record<string, NostrEvent> = {};
    for (const id of noteIds) {
      const ev = s.events.entities[id];
      if (ev && ev.pubkey === pubkey) result[id] = ev;
    }
    return result;
  }, shallowEqual);

  const repostEvents = useAppSelector((s) => {
    if (!repostIds) return null;
    const result: Record<string, NostrEvent> = {};
    for (const id of repostIds) {
      const ev = s.events.entities[id];
      if (ev && ev.kind === 6) result[id] = ev;
    }
    return result;
  }, shallowEqual);

  // Build all feed items sorted by created_at desc
  const allItems = useMemo(() => {
    const items: ProfileFeedItem[] = [];

    if (noteEvents) {
      for (const ev of Object.values(noteEvents)) {
        items.push({ event: ev, repostedEventId: null, reposterPubkey: null });
      }
    }

    if (repostEvents) {
      for (const ev of Object.values(repostEvents)) {
        const targetId = ev.tags.find((t) => t[0] === "e")?.[1] ?? null;
        items.push({
          event: ev,
          repostedEventId: targetId,
          reposterPubkey: ev.pubkey,
        });
      }
    }

    items.sort((a, b) => b.event.created_at - a.event.created_at);

    // Track oldest timestamp for relay pagination
    if (items.length > 0) {
      oldestTimestampRef.current = items[items.length - 1].event.created_at;
    }

    return items;
  }, [noteEvents, repostEvents]);

  // --- Pre-classify items once, then derive tabs from classification ---
  const classified = useMemo(() => {
    const roots: ProfileFeedItem[] = [];
    const repostList: ProfileFeedItem[] = [];
    const replyList: ProfileFeedItem[] = [];
    const mediaList: ProfileFeedItem[] = [];

    for (const item of allItems) {
      if (item.repostedEventId) {
        repostList.push(item);
        continue;
      }
      if (item.event.kind !== 1) continue;

      const ref = parseThreadRef(item.event);
      if (ref.rootId !== null) {
        replyList.push(item);
      } else {
        roots.push(item);
        if (hasMediaUrls(item.event.content) || hasEmbedUrls(item.event.content)) {
          mediaList.push(item);
        }
      }
    }

    return { roots, repostList, replyList, mediaList };
  }, [allItems]);

  // Paginated getters — only slice when needed
  const rootNotes = useMemo(
    () => classified.roots.slice(0, notesPage * PAGE_SIZE),
    [classified.roots, notesPage],
  );
  const reposts = useMemo(
    () => classified.repostList.slice(0, repostsPage * PAGE_SIZE),
    [classified.repostList, repostsPage],
  );
  const replies = useMemo(
    () => classified.replyList.slice(0, repliesPage * PAGE_SIZE),
    [classified.replyList, repliesPage],
  );
  const mediaItems = useMemo(
    () => classified.mediaList.slice(0, mediaPage * PAGE_SIZE),
    [classified.mediaList, mediaPage],
  );

  // Articles — targeted selector
  const articles = useAppSelector((s): LongFormArticle[] => {
    if (!longformIds) return [];
    const result: NostrEvent[] = [];
    for (const id of longformIds) {
      const ev = s.events.entities[id];
      if (ev && ev.pubkey === pubkey) result.push(ev);
    }
    result.sort((a, b) => b.created_at - a.created_at);
    return result.map(parseLongFormEvent);
  }, shallowEqual);

  const paginatedArticles = useMemo(
    () => articles.slice(0, articlesPage * PAGE_SIZE),
    [articles, articlesPage],
  );

  // "Has more" flags
  const hasMoreNotes = classified.roots.length > notesPage * PAGE_SIZE;
  const hasMoreReposts = classified.repostList.length > repostsPage * PAGE_SIZE;
  const hasMoreReplies = classified.replyList.length > repliesPage * PAGE_SIZE;
  const hasMoreMedia = classified.mediaList.length > mediaPage * PAGE_SIZE;
  const hasMoreArticles = articles.length > articlesPage * PAGE_SIZE;

  // Load more callbacks
  const loadMoreNotes = useCallback(() => setNotesPage((p) => p + 1), []);
  const loadMoreReposts = useCallback(() => setRepostsPage((p) => p + 1), []);
  const loadMoreReplies = useCallback(() => setRepliesPage((p) => p + 1), []);
  const loadMoreMedia = useCallback(() => setMediaPage((p) => p + 1), []);
  const loadMoreArticles = useCallback(() => setArticlesPage((p) => p + 1), []);

  // Fetch older events from relays when all local items are exhausted
  const fetchOlderFromRelay = useCallback(() => {
    if (fetchingMore || !eoseReceived || oldestTimestampRef.current === 0) return;
    setFetchingMore(true);

    const subId = subscriptionManager.subscribe({
      filters: [{
        kinds: [1, 6],
        authors: [pubkey],
        until: oldestTimestampRef.current,
        limit: 50,
      }],
      onEOSE: () => {
        setFetchingMore(false);
        subscriptionManager.close(subId);
      },
    });
  }, [pubkey, eoseReceived, fetchingMore]);

  const loading = allItems.length === 0 && !eoseReceived;

  return {
    allItems,
    rootNotes,
    reposts,
    replies,
    mediaItems,
    articles: paginatedArticles,
    loading,
    eoseReceived,
    articlesEose,
    fetchingMore,
    // Pagination controls
    hasMoreNotes,
    hasMoreReposts,
    hasMoreReplies,
    hasMoreMedia,
    hasMoreArticles,
    loadMoreNotes,
    loadMoreReposts,
    loadMoreReplies,
    loadMoreMedia,
    loadMoreArticles,
    fetchOlderFromRelay,
    // Total counts for stats
    totalNotes: classified.roots.length,
    totalReposts: classified.repostList.length,
    totalReplies: classified.replyList.length,
    totalMedia: classified.mediaList.length,
    totalArticles: articles.length,
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
