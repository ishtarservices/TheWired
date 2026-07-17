// ─── Embedded-event resolution ───────────────────────────────────────
// Mobile analog of the desktop useEmbeddedEvent: resolve an event/addr ref
// to a NostrEvent for the compact embed card. Resolution order:
//   1. the feed slice (already-verified events, O(1)),
//   2. a bounded module cache shared by every card (repeat refs are free),
//   3. a one-shot engine.fetchEvents REQ on the existing pool — no new
//      resting sockets. In-flight promises dedup so N cards for the same
//      ref fetch once.
// Addressable refs pin authors:[pubkey] (d-tag forgery guard, desktop
// parity). Relay hints were sanitized by parseContent but are NOT dialed —
// engine.fetchEvents has no per-call relay param yet; refs that live only
// on foreign relays resolve as "unavailable" until the engine grows one.

import { useEffect, useState } from "react";
import type { NostrEvent, NostrFilter } from "@thewired/shared-types";

import { useEngine } from "@/lib/nostr/EngineContext";
import type { NostrEngine } from "@/lib/nostr/engine";
import type { ContentSegment } from "@/lib/nostr/parseContent";
import { useAppSelector } from "@/store/hooks";
import { selectFeedEvent } from "@/store/slices/feedSlice";

export type EmbedRef =
  | Extract<ContentSegment, { type: "event-ref" }>
  | Extract<ContentSegment, { type: "addr-ref" }>;

const CACHE_MAX = 200;
/** ref key → resolved event, or null = fetched and confirmed missing. */
const cache = new Map<string, NostrEvent | null>();
const inFlight = new Map<string, Promise<NostrEvent | null>>();

function refKey(ref: EmbedRef): string {
  return ref.type === "event-ref"
    ? `e:${ref.id}`
    : `a:${ref.kind}:${ref.pubkey}:${ref.identifier}`;
}

function remember(key: string, event: NostrEvent | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, event);
}

function fetchRef(engine: NostrEngine, ref: EmbedRef, key: string): Promise<NostrEvent | null> {
  const pending = inFlight.get(key);
  if (pending) return pending;

  const filter: NostrFilter =
    ref.type === "event-ref"
      ? { ids: [ref.id] }
      : { kinds: [ref.kind], authors: [ref.pubkey], "#d": [ref.identifier], limit: 1 };

  const promise = engine
    .fetchEvents([filter])
    .then((events) => {
      // Addressable: newest wins (replaceable semantics).
      const event =
        events.length === 0
          ? null
          : events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
      remember(key, event);
      return event;
    })
    .catch(() => null) // transient failure — not cached; a later mount retries
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

export interface UseEmbeddedEventResult {
  event: NostrEvent | null;
  /** Still resolving — render a skeleton. */
  loading: boolean;
  /** Confirmed missing — render "note unavailable", never the raw bech32. */
  notFound: boolean;
}

export function useEmbeddedEvent(ref: EmbedRef): UseEmbeddedEventResult {
  const engine = useEngine();
  const key = refKey(ref);

  // Fast paths: feed slice (event ids only), then the module cache.
  const feedEvent = useAppSelector((s) =>
    ref.type === "event-ref" ? selectFeedEvent(s, ref.id) : undefined,
  );
  const cacheHit = cache.has(key) ? cache.get(key) : undefined;

  // Keyed so a recycled component with a new ref never shows the old result.
  const [fetched, setFetched] = useState<{ key: string; event: NostrEvent | null }>();
  const fetchedHit = fetched && fetched.key === key ? fetched.event : undefined;

  // undefined = unknown yet · null = confirmed missing · event = resolved.
  // Explicit chain (NOT ??) — a null step means "confirmed missing" and
  // must not fall through to the next source.
  let resolved: NostrEvent | null | undefined = feedEvent;
  if (resolved === undefined) resolved = cacheHit;
  if (resolved === undefined) resolved = fetchedHit;
  const unknown = resolved === undefined;

  useEffect(() => {
    if (!unknown) return;
    let alive = true;
    fetchRef(engine, ref, key).then((event) => {
      if (alive) setFetched({ key, event });
    });
    return () => {
      alive = false;
    };
    // `key` encodes every ref field the fetch reads — ref itself is a fresh
    // object per render and must stay out of the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, key, unknown]);

  return {
    event: resolved ?? null,
    loading: unknown,
    notFound: resolved === null,
  };
}

/** Test hook — the module cache survives across mounts by design. */
export function clearEmbedCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
