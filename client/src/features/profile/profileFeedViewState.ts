/**
 * Module-level "where I was" store for profile pages.
 *
 * A profile page unmounts whenever you navigate to a different route — Back from
 * an article (`/article/:id`), a DM (`/dm/:pubkey`), the editor (`/write`), or
 * across profiles — and remounts on return. React-local state (active tab, how
 * many pages were loaded, scroll offset) is lost on that round-trip, so the feed
 * would snap back to the top / first page. This store survives unmounts and lets
 * `ProfilePage` / `useProfileFeed` resume where the user left off. (Opening a
 * note no longer navigates — the card expands the thread inline — so that
 * particular round-trip is gone, but the others remain.)
 *
 * The events themselves persist in Redux, so restoring the page count re-renders
 * the same items synchronously — only the view position needs remembering.
 */

export type ProfileTabKey =
  | "notes"
  | "reposts"
  | "replies"
  | "media"
  | "reads"
  | "music"
  | "showcase";

/** Page counts mirror the per-tab pagination in `useProfileFeed`. */
export interface ProfileFeedPages {
  notes: number;
  reposts: number;
  replies: number;
  media: number;
  articles: number;
}

/** A feed card to land back on, plus how far the viewport was scrolled past it. */
export interface ProfileScrollAnchor {
  /** Event id of the card the viewport top was sitting on. */
  id: string;
  /** Px the container was scrolled past that card's top (>= 0). */
  offset: number;
}

export interface ProfileViewState {
  activeTab: ProfileTabKey;
  pages: ProfileFeedPages;
  scrollTop: Partial<Record<ProfileTabKey, number>>;
  /** Anchor card per tab — survives async media growth where a pixel offset can't. */
  anchor: Partial<Record<ProfileTabKey, ProfileScrollAnchor>>;
}

export const DEFAULT_PROFILE_PAGES: ProfileFeedPages = {
  notes: 1,
  reposts: 1,
  replies: 1,
  media: 1,
  articles: 1,
};

/** Cap remembered profiles; evict the least-recently-written on overflow. */
const MAX_PROFILES = 24;

const store = new Map<string, ProfileViewState>();

export function readProfileView(pubkey: string): ProfileViewState | undefined {
  return store.get(pubkey);
}

export function readProfilePages(pubkey: string): ProfileFeedPages {
  return store.get(pubkey)?.pages ?? { ...DEFAULT_PROFILE_PAGES };
}

/** Shallow-merge a partial view state, refreshing recency for LRU eviction. */
export function writeProfileView(
  pubkey: string,
  patch: Partial<ProfileViewState>,
): void {
  const prev: ProfileViewState = store.get(pubkey) ?? {
    activeTab: "notes",
    pages: { ...DEFAULT_PROFILE_PAGES },
    scrollTop: {},
    anchor: {},
  };
  const next: ProfileViewState = {
    activeTab: patch.activeTab ?? prev.activeTab,
    pages: patch.pages ? { ...prev.pages, ...patch.pages } : prev.pages,
    scrollTop: patch.scrollTop
      ? { ...prev.scrollTop, ...patch.scrollTop }
      : prev.scrollTop,
    anchor: patch.anchor ? { ...prev.anchor, ...patch.anchor } : prev.anchor,
  };
  // Re-insert to mark most-recently-used.
  store.delete(pubkey);
  store.set(pubkey, next);
  if (store.size > MAX_PROFILES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}
