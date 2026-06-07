import { useState, useEffect, useMemo } from "react";
import { nip19 } from "nostr-tools";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "../../lib/nostr/constants";
import { parseLongFormEvent } from "./useLongForm";
import type { NostrEvent, NostrFilter } from "../../types/nostr";
import type { LongFormArticle } from "../../types/media";

interface Resolved {
  filter: NostrFilter;
  match: (e: NostrEvent) => boolean;
  relays: string[];
}

/**
 * Turn a route param (NIP-19 naddr/nevent/note OR a raw 64-char hex event id)
 * into a subscription filter + a store-matcher. For addressable articles we pin
 * `authors` (security: otherwise anyone could publish the same d-tag and we'd
 * accept the forgery).
 */
export function resolveArticleRef(idParam: string): Resolved | null {
  if (/^[0-9a-f]{64}$/i.test(idParam)) {
    const id = idParam.toLowerCase();
    return { filter: { ids: [id], limit: 1 }, match: (e) => e.id === id, relays: PROFILE_RELAYS };
  }
  try {
    const dec = nip19.decode(idParam);
    if (dec.type === "naddr") {
      const { kind, pubkey, identifier, relays } = dec.data;
      const hints = relays && relays.length ? [...PROFILE_RELAYS, ...relays] : PROFILE_RELAYS;
      return {
        filter: { kinds: [kind], authors: [pubkey], "#d": [identifier], limit: 1 },
        match: (e) =>
          e.kind === kind &&
          e.pubkey === pubkey &&
          e.tags.some((t) => t[0] === "d" && t[1] === identifier),
        relays: hints,
      };
    }
    if (dec.type === "nevent") {
      const { id, relays } = dec.data;
      const hints = relays && relays.length ? [...PROFILE_RELAYS, ...relays] : PROFILE_RELAYS;
      return { filter: { ids: [id], limit: 1 }, match: (e) => e.id === id, relays: hints };
    }
    if (dec.type === "note") {
      const id = dec.data;
      return { filter: { ids: [id], limit: 1 }, match: (e) => e.id === id, relays: PROFILE_RELAYS };
    }
  } catch {
    return null;
  }
  return null;
}

export interface UseArticleResult {
  article: LongFormArticle | null;
  raw: NostrEvent | null;
  loading: boolean;
  notFound: boolean;
}

/**
 * Resolve a single long-form article for the reader route. Accepts a hex event
 * id or an naddr/nevent/note. Reads from the Redux store first (the event is
 * often already cached from a feed) and otherwise subscribes to fetch it.
 */
export function useArticle(idParam: string): UseArticleResult {
  const resolved = useMemo(() => resolveArticleRef(idParam), [idParam]);
  const [eose, setEose] = useState(false);

  const allEvents = useAppSelector((s) => eventsSelectors.selectAll(s.events));
  const raw = useMemo(() => {
    if (!resolved) return null;
    const matches = allEvents.filter(resolved.match);
    if (matches.length === 0) return null;
    // Addressable articles can have multiple versions — keep the newest.
    return matches.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  }, [allEvents, resolved]);

  useEffect(() => {
    if (!resolved || raw) {
      setEose(!!raw);
      return;
    }
    setEose(false);
    const subId = subscriptionManager.subscribe({
      filters: [resolved.filter],
      relayUrls: resolved.relays,
      onEOSE: () => setEose(true),
    });
    return () => subscriptionManager.close(subId);
  }, [resolved, raw]);

  const article = useMemo(() => (raw ? parseLongFormEvent(raw) : null), [raw]);

  return {
    article,
    raw,
    loading: !!resolved && !raw && !eose,
    notFound: !resolved || (!raw && eose),
  };
}
