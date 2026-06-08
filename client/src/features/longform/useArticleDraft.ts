import { useEffect, useRef } from "react";

/** Where an article is published (soft "space-exclusive" mirrors music). */
export type ArticleVisibility = "public" | "space";

/** A persisted, in-progress article (everything the editor needs to restore). */
export interface ArticleDraft {
  title: string;
  summary: string;
  image: string;
  /** Raw comma-separated tag string as typed in the editor. */
  tags: string;
  content: string;
  visibility: ArticleVisibility;
  spaceId: string;
  channelId: string;
  savedAt: number;
}

const PREFIX = "wired:article-draft:";

/** localStorage key, namespaced per account and per article id ("new" or slug). */
function draftKey(pubkey: string, id: string): string {
  return `${PREFIX}${pubkey}:${id}`;
}

/** Read a saved draft. Returns null when absent or corrupt (never throws). */
export function loadArticleDraft(pubkey: string, id: string): ArticleDraft | null {
  if (!pubkey) return null;
  try {
    const raw = localStorage.getItem(draftKey(pubkey, id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Tolerate partial/older shapes by filling defaults.
    return {
      title: String(parsed.title ?? ""),
      summary: String(parsed.summary ?? ""),
      image: String(parsed.image ?? ""),
      tags: String(parsed.tags ?? ""),
      content: String(parsed.content ?? ""),
      visibility: parsed.visibility === "space" ? "space" : "public",
      spaceId: String(parsed.spaceId ?? ""),
      channelId: String(parsed.channelId ?? ""),
      savedAt: Number(parsed.savedAt ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

/** Persist a draft (no-op on quota/serialization errors). */
export function saveArticleDraft(pubkey: string, id: string, draft: ArticleDraft): void {
  if (!pubkey) return;
  try {
    localStorage.setItem(draftKey(pubkey, id), JSON.stringify(draft));
  } catch {
    // Storage full / unavailable — autosave is best-effort, never fatal.
  }
}

/** Remove a saved draft (call after a successful publish or explicit discard). */
export function clearArticleDraft(pubkey: string, id: string): void {
  if (!pubkey) return;
  try {
    localStorage.removeItem(draftKey(pubkey, id));
  } catch {
    /* ignore */
  }
}

/** True when a draft holds something worth keeping. */
function isMeaningful(draft: ArticleDraft): boolean {
  return draft.title.trim().length > 0 || draft.content.trim().length > 0;
}

/**
 * Debounced autosave for the article editor. Writes the draft to localStorage
 * ~800ms after the last edit so navigating away or refreshing never loses work.
 * Disable (`enabled: false`) while the initial draft is loading or during a
 * publish so we don't clobber/persist transient states.
 */
export function useArticleDraft(opts: {
  pubkey: string | null;
  id: string;
  draft: ArticleDraft;
  enabled: boolean;
}): void {
  const { pubkey, id, draft, enabled } = opts;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !pubkey) return;
    if (!isMeaningful(draft)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveArticleDraft(pubkey, id, { ...draft, savedAt: Math.floor(Date.now() / 1000) });
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pubkey, id, enabled, draft]);
}
