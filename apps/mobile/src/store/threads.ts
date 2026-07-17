// Thread-cache persistence thunks — hydrate a conversation's stored events
// into threadsSlice and write it back through the StorageAdapter (threads
// store; per-account DB when logged in, app DB for guests — the spaceChat.ts
// pattern). One row per thread ROOT id, value { savedAt, events } so pruning
// can evict the stalest rows without parsing every event array. Writes are
// immediate; useThread owns the debounce so no module-level timer state
// leaks across identities.

import type { NostrEvent } from "@thewired/shared-types";

import type { AppThunk } from "@/store";
import { threadHydrated } from "./slices/threadsSlice";

/** Newest events persisted per thread row (the root is always retained). */
export const PERSIST_PER_THREAD = 60;
/** Max persisted conversations — stalest rows pruned past this. */
export const THREAD_PERSIST_ROOTS = 20;

interface ThreadRow {
  savedAt: number;
  events: NostrEvent[];
}

function isValidEvent(e: unknown): e is NostrEvent {
  const event = e as NostrEvent | null;
  return !!event && typeof event.id === "string" && typeof event.created_at === "number";
}

/**
 * Cold-start root resolution from storage: `aliasToRoot` is session-only,
 * so a relaunch + deep link onto a mid-thread note can't map noteId → root
 * without the network — even though the conversation sits in SQLite (rows
 * are keyed by ROOT id). Scan the (≤ THREAD_PERSIST_ROOTS) rows for the
 * note, hydrate the hit, and return its root id. Returns undefined when the
 * note is in no stored conversation.
 */
export function resolveRootFromStorage(noteId: string): AppThunk<Promise<string | undefined>> {
  return async (dispatch, getState, { adapters }) => {
    const known = getState().threads.aliasToRoot[noteId];
    if (known) return known;
    try {
      const store = adapters.storage.getStore<ThreadRow>("threads");
      const keys = await store.getAllKeys();
      if (keys.includes(noteId)) {
        await dispatch(hydrateThread(noteId));
        return noteId;
      }
      for (const key of keys) {
        const row = await store.get(key);
        if (row?.events?.some((e) => e?.id === noteId)) {
          await dispatch(hydrateThread(key));
          return key;
        }
      }
    } catch {
      // fresh device / corrupt store — fall through to network resolution
    }
    return undefined;
  };
}

export function hydrateThread(rootId: string): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    if (getState().threads.hydrated[rootId]) return;
    let events: NostrEvent[] = [];
    try {
      const stored = await adapters.storage.getStore<ThreadRow>("threads").get(rootId);
      if (stored && Array.isArray(stored.events)) {
        events = stored.events.filter(isValidEvent);
      }
    } catch {
      // corrupt row / fresh device — hydrate empty; loadThread rebuilds
    }
    dispatch(threadHydrated({ rootId, events }));
  };
}

export function persistThread(rootId: string): AppThunk<Promise<void>> {
  return async (_dispatch, getState, { adapters }) => {
    const entry = getState().threads.byRoot[rootId];
    // Empty-guard doubles as the identity-switch valve: threadsCleared fires
    // before the account DB swap, so a late unmount flush sees an empty
    // slice and no-ops instead of writing into the next account's DB.
    if (!entry || entry.events.length === 0) return;

    // Newest PERSIST_PER_THREAD, but never drop the root event — it's the
    // oldest in the conversation and must survive to render the focus.
    const root = entry.events.find((e) => e.id === rootId);
    const kept = entry.events
      .filter((e) => e.id !== rootId)
      .slice(-(root ? PERSIST_PER_THREAD - 1 : PERSIST_PER_THREAD));
    const events = root ? [root, ...kept] : kept;

    try {
      const store = adapters.storage.getStore<ThreadRow>("threads");
      await store.put(rootId, { savedAt: Date.now(), events });

      // Prune stalest rows past the cap (row count stays tiny — getAll is fine).
      const keys = await store.getAllKeys();
      if (keys.length > THREAD_PERSIST_ROOTS) {
        const rows = await Promise.all(
          keys.map(async (key) => ({ key, row: await store.get(key) })),
        );
        rows
          .sort((a, b) => (a.row?.savedAt ?? 0) - (b.row?.savedAt ?? 0))
          .slice(0, keys.length - THREAD_PERSIST_ROOTS)
          .forEach(({ key }) => {
            store.delete(key).catch(() => {});
          });
      }
    } catch {
      // best-effort — a missing row only costs one relay round trip later
    }
  };
}
