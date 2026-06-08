import { useEffect, useMemo, useState } from "react";
import { useAppSelector } from "../../store/hooks";
import { eventsSelectors } from "../../store/slices/eventsSlice";
import { subscriptionManager } from "../../lib/nostr/subscriptionManager";
import { PROFILE_RELAYS } from "../../lib/nostr/constants";
import { isSafeRelayUrl } from "../../lib/security/ssrfGuard";
import type { NostrEvent, NostrFilter } from "../../types/nostr";

/**
 * A parsed reference to a single event, as produced by `parseContent`
 * (`event-ref` / `addr-ref` segments) or a NIP-18 `q` tag.
 */
export interface EventRef {
  /** event-ref: a 64-char hex event id (from nevent / note) */
  id?: string;
  /** addr-ref: addressable-coordinate kind (from naddr) */
  kind?: number;
  /** addr-ref: addressable-coordinate author */
  pubkey?: string;
  /** addr-ref: addressable-coordinate `d` identifier */
  identifier?: string;
  /** Relay hints from the encoding — UNTRUSTED, sanitized before dialing. */
  relays?: string[];
  /** Author hint from an nevent — UNTRUSTED, advisory only. */
  author?: string;
}

interface Resolved {
  filter: NostrFilter;
  match: (e: NostrEvent) => boolean;
  relays: string[];
  /** true when this resolves an addressable (naddr) coordinate */
  addressable: boolean;
  /** the (lowercased) event id for the O(1) store fast-path — event-ref only */
  id?: string;
}

const EMPTY_EVENTS: NostrEvent[] = [];

/** Merge sanitized untrusted relay hints with the default profile relays. */
function withHints(relays?: string[]): string[] {
  if (!relays || relays.length === 0) return PROFILE_RELAYS;
  // Relay hints ride along inside attacker-authored events; drop anything that
  // points at a private/loopback address (SSRF) before we dial it.
  const safe = relays.filter((u) => {
    try {
      return isSafeRelayUrl(u);
    } catch {
      return false;
    }
  });
  return safe.length ? [...PROFILE_RELAYS, ...safe] : PROFILE_RELAYS;
}

/**
 * Turn a parsed event-ref / addr-ref into a subscription filter + a store
 * matcher. For addressable coordinates we pin `authors` (security: otherwise
 * anyone could publish the same `d` tag and we'd accept the forgery — see the
 * nostr-security skill).
 */
export function resolveEmbedRef(ref: EventRef): Resolved | null {
  if (ref.id && /^[0-9a-f]{64}$/i.test(ref.id)) {
    const id = ref.id.toLowerCase();
    return {
      filter: { ids: [id], limit: 1 },
      match: (e) => e.id === id,
      relays: withHints(ref.relays),
      addressable: false,
      id,
    };
  }
  if (
    typeof ref.kind === "number" &&
    ref.pubkey &&
    typeof ref.identifier === "string"
  ) {
    const { kind, pubkey, identifier } = ref;
    return {
      filter: { kinds: [kind], authors: [pubkey], "#d": [identifier], limit: 1 },
      match: (e) =>
        e.kind === kind &&
        e.pubkey === pubkey &&
        e.tags.some((t) => t[0] === "d" && t[1] === identifier),
      relays: withHints(ref.relays),
      addressable: true,
    };
  }
  return null;
}

export interface UseEmbeddedEventResult {
  event: NostrEvent | null;
  loading: boolean;
  notFound: boolean;
}

/**
 * Resolve a single referenced event for an inline embed. Reads the Redux store
 * first (the event is often already cached from a feed) and otherwise subscribes
 * to fetch it. Mirrors `useArticle`, generalized to any kind.
 */
export function useEmbeddedEvent(ref: EventRef): UseEmbeddedEventResult {
  const resolved = useMemo(
    () => resolveEmbedRef(ref),
    // Identity is fully determined by these fields; relay/author only affect
    // which relays we dial. Depend on primitives so a fresh `ref` object each
    // render doesn't rebuild the subscription.
    [ref.id, ref.kind, ref.pubkey, ref.identifier, ref.relays?.join(","), ref.author],
  );

  const [eose, setEose] = useState(false);

  // Fast O(1) path for event-ref by id; addressable falls back to a scan.
  const byId = useAppSelector((s) =>
    resolved && !resolved.addressable && resolved.id
      ? eventsSelectors.selectById(s.events, resolved.id)
      : undefined,
  );
  const allEvents = useAppSelector((s) =>
    resolved && resolved.addressable
      ? eventsSelectors.selectAll(s.events)
      : EMPTY_EVENTS,
  );

  const event = useMemo(() => {
    if (!resolved) return null;
    if (!resolved.addressable) return byId ?? null;
    const matches = allEvents.filter(resolved.match);
    if (matches.length === 0) return null;
    // Addressable events can have multiple versions — keep the newest.
    return matches.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  }, [resolved, byId, allEvents]);

  useEffect(() => {
    if (!resolved || event) {
      setEose(!!event);
      return;
    }
    setEose(false);
    const subId = subscriptionManager.subscribe({
      filters: [resolved.filter],
      relayUrls: resolved.relays,
      onEOSE: () => setEose(true),
    });
    return () => subscriptionManager.close(subId);
  }, [resolved, event]);

  return {
    event,
    loading: !!resolved && !event && !eose,
    notFound: !resolved || (!event && eose),
  };
}
