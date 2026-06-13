import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteDraft,
  getDraftsForAccount,
  migrateLegacyArticleDraft,
  renameDraft,
  upsertDraft,
} from "@/lib/db/articleDraftStore";
import type {
  ArticleDraftFields,
  ArticleDraftRecord,
  ArticleVisibility,
} from "@/types/media";

// Canonical types live in @/types/media so the IndexedDB layer can share them.
// Re-exported here so existing `./useArticleDraft` imports keep working.
export type { ArticleDraftFields, ArticleDraftRecord, ArticleVisibility };

/** True when a draft holds something worth persisting. */
function isMeaningful(fields: ArticleDraftFields): boolean {
  return fields.title.trim().length > 0 || fields.content.trim().length > 0;
}

/**
 * Debounced autosave for the article editor. Writes the active session into its
 * own draft record ~800ms after the last edit, so navigating away or refreshing
 * never loses work. Disable (`enabled: false`) while the draft is still
 * hydrating or during a publish so we don't clobber/persist transient states.
 *
 * The `fields` object is recreated each render on purpose — the effect re-runs
 * and resets the debounce timer on every keystroke.
 */
export function useArticleDraftAutosave(opts: {
  pubkey: string | null;
  draftId: string;
  fields: ArticleDraftFields;
  enabled: boolean;
}): void {
  const { pubkey, draftId, fields, enabled } = opts;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !pubkey || !draftId) return;
    if (!isMeaningful(fields)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void upsertDraft(pubkey, draftId, fields);
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pubkey, draftId, enabled, fields]);
}

/**
 * Load + manage the device-local drafts list for an account. Runs the one-time
 * localStorage → IndexedDB migration before the first read. `remove`/`rename`
 * mutate IndexedDB and optimistically update local state.
 */
export function useArticleDrafts(pubkey: string | null): {
  drafts: ArticleDraftRecord[];
  loading: boolean;
  refresh: () => void;
  remove: (id: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
} {
  const [drafts, setDrafts] = useState<ArticleDraftRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (isStale: () => boolean = () => false) => {
      if (!pubkey) {
        setDrafts([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        await migrateLegacyArticleDraft(pubkey);
        const list = await getDraftsForAccount(pubkey);
        if (!isStale()) setDrafts(list);
      } catch {
        if (!isStale()) setDrafts([]);
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    [pubkey],
  );

  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);

  const remove = useCallback(async (id: string) => {
    await deleteDraft(id);
    setDrafts((cur) => cur.filter((d) => d.id !== id));
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    await renameDraft(id, title);
    setDrafts((cur) =>
      cur
        .map((d) => (d.id === id ? { ...d, title, updatedAt: Date.now() } : d))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }, []);

  return { drafts, loading, refresh, remove, rename };
}
