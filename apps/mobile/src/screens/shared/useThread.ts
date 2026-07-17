// Thread data for NoteThreadScreen: resolve the conversation root for a
// note id, hydrate the stored conversation (SQLite, before network), read
// the session cache, build the tree, backfill missing ancestors, and
// trigger the SWR load. Root resolution order: route param (caller had the
// event in hand) → alias index (any cached conversation containing the
// note) → feed cache parse → one-shot {ids:[noteId]} fetch. Cache-warm
// opens render instantly; the loadThread refresh runs behind them.

import { useEffect, useMemo, useRef, useState } from "react";
import { buildThreadTree, directParentId, parseThreadRef, type ThreadTree } from "@thewired/core";
import type { NostrEvent } from "@thewired/shared-types";

import { useEngine } from "@/lib/nostr/EngineContext";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectFeedEvent } from "@/store/slices/feedSlice";
import { selectAnyRelayConnected } from "@/store/slices/relaysSlice";
import {
  selectRootIdFor,
  selectThreadEntry,
  selectThreadEvents,
  threadEventsMerged,
  THREAD_STALE_SEC,
  type ThreadEntry,
} from "@/store/slices/threadsSlice";
import { hydrateThread, persistThread, resolveRootFromStorage } from "@/store/threads";

/** Trailing debounce for the SQLite write-back (ChannelScreen parity). */
const PERSIST_DEBOUNCE_MS = 400;
/** Ancestor-backfill budget per mount — pathological chains stop honestly. */
const MAX_ANCESTOR_FETCHES = 25;

export interface UseThreadResult {
  /** Conversation root — undefined while resolving (or when resolution failed). */
  rootId: string | undefined;
  entry: ThreadEntry | undefined;
  events: NostrEvent[];
  /** Built from the cached events; null until the root id is known. */
  tree: ThreadTree | null;
  /** The note couldn't be found on the connected relays. */
  notFound: boolean;
}

export function useThread(noteId: string, rootIdParam?: string): UseThreadResult {
  const engine = useEngine();
  const dispatch = useAppDispatch();

  const aliasRoot = useAppSelector((s) => selectRootIdFor(s, noteId));
  const cachedNote = useAppSelector((s) => selectFeedEvent(s, noteId));
  const anyRelayConnected = useAppSelector(selectAnyRelayConnected);
  const [resolvedRoot, setResolvedRoot] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const cachedRoot = cachedNote ? (parseThreadRef(cachedNote).rootId ?? noteId) : undefined;
  const rootId = rootIdParam ?? aliasRoot ?? cachedRoot ?? resolvedRoot ?? undefined;

  // Last-resort root resolution: storage scan first (a relaunch + deep link
  // can't map noteId → root via the session alias index, but the persisted
  // conversation can), then a one-shot {ids} fetch. Re-runs on the
  // relay-connected edge: at cold boot this races the socket dial and an
  // empty answer must not be a permanent "Note unavailable" dead end.
  useEffect(() => {
    if (rootId) return;
    let cancelled = false;
    (async () => {
      const storedRoot = await dispatch(resolveRootFromStorage(noteId)).catch(
        () => undefined,
      );
      if (cancelled) return;
      if (storedRoot) {
        setNotFound(false);
        setResolvedRoot(storedRoot);
        return;
      }
      const events = await engine.fetchEvents([{ ids: [noteId] }]);
      if (cancelled) return;
      const event = events.find((e) => e.id === noteId);
      if (!event) {
        setNotFound(true);
        return;
      }
      const root = parseThreadRef(event).rootId ?? noteId;
      dispatch(threadEventsMerged({ rootId: root, events: [event] }));
      setNotFound(false);
      setResolvedRoot(root);
    })().catch(() => {
      if (!cancelled) setNotFound(true);
    });
    return () => {
      cancelled = true;
    };
  }, [engine, dispatch, rootId, noteId, anyRelayConnected]);

  // The focus event may live only in the feed cache (feedSlice prunes at
  // FEED_CAP; the thread cache owns its own copy) — seed it across so the
  // focused note paints before the network answers.
  useEffect(() => {
    if (rootId && cachedNote) {
      dispatch(threadEventsMerged({ rootId, events: [cachedNote] }));
    }
  }, [dispatch, rootId, cachedNote]);

  // Hydrate the stored conversation (no-ops once per session per root; the
  // read races loadThread — the reducer merges either order identically).
  useEffect(() => {
    if (rootId) dispatch(hydrateThread(rootId)).catch(() => {});
  }, [dispatch, rootId]);

  const entry = useAppSelector((s) => selectThreadEntry(s, rootId));
  const events = useAppSelector((s) => selectThreadEvents(s, rootId));

  const tree = useMemo(
    () => (rootId ? buildThreadTree(events, { rootId, focusId: noteId }) : null),
    [events, rootId, noteId],
  );

  // SWR: load once per (rootId, noteId) mount — cold, seeded-only ("idle"),
  // or stale entries refetch; a fresh "ready" renders straight from cache.
  // Imperative entry read (ref) so status flips can't re-trigger the effect.
  // Re-runs on the relay-connected edge: a load that raced the cold-boot
  // socket dial settles "ready" with nothing — retry once relays are up.
  const entryRef = useRef(entry);
  entryRef.current = entry;
  useEffect(() => {
    if (!rootId) return;
    const current = entryRef.current;
    const staleAt = Math.floor(Date.now() / 1000) - THREAD_STALE_SEC;
    const shouldLoad =
      !current || current.status === "idle" ||
      (current.status === "ready" &&
        (current.fetchedAt < staleAt || current.events.length === 0));
    if (shouldLoad) engine.loadThread(rootId, noteId).catch(() => {});
  }, [engine, rootId, noteId, anyRelayConnected]);

  // Ancestor backfill: while the chain doesn't reach the root, fetch the
  // next missing parent by id. Each merged hop recomputes the tree, which
  // re-runs this effect for the hop above — an unfetchable event stops the
  // walk (attempted-set) and the gap row stays, honestly. The root itself
  // is loadThread's job.
  const attemptedAncestors = useRef(new Set<string>());
  useEffect(() => {
    if (!rootId || !tree?.focus || tree.ancestorsComplete) return;
    const topmost = tree.ancestors[0] ?? tree.focus.event;
    const missing = directParentId(topmost);
    if (!missing || missing === rootId) return;
    const attempted = attemptedAncestors.current;
    if (attempted.has(missing) || attempted.size >= MAX_ANCESTOR_FETCHES) return;
    attempted.add(missing);
    engine
      .fetchEvents([{ ids: [missing] }])
      .then((fetched) => {
        const event = fetched.find((e) => e.id === missing);
        if (event) dispatch(threadEventsMerged({ rootId, events: [event] }));
      })
      .catch(() => {});
  }, [engine, dispatch, rootId, tree]);

  // Write-back: debounced while the conversation grows, flushed on unmount.
  const rootIdRef = useRef(rootId);
  rootIdRef.current = rootId;
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!rootId || events.length === 0) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      dispatch(persistThread(rootId)).catch(() => {});
    }, PERSIST_DEBOUNCE_MS);
  }, [dispatch, rootId, events]);
  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      const root = rootIdRef.current;
      if (root) dispatch(persistThread(root)).catch(() => {});
    },
    [dispatch],
  );

  return { rootId, entry, events, tree, notFound };
}
