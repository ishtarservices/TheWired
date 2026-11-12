import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import type { AppDispatch } from "../store";
import { setSidebarMode, type SidebarMode } from "../store/slices/uiSlice";
import { setActiveSpace, setActiveChannel } from "../store/slices/spacesSlice";
import { restoreMusicView } from "../store/slices/musicSlice";
import { setActiveConversation } from "../store/slices/dmSlice";
import type { MusicView } from "../types/music";

/**
 * The app's one back/forward history.
 *
 * Most of what the user thinks of as "a page" is Redux state, not a route
 * (which space, which music view, which project), so the browser's history
 * can't walk it. This records each settled combination of route + state and
 * restores it on back/forward.
 *
 * Both the top-bar arrows and the Back link on a music detail page read from
 * here, so they can never disagree about where "back" is. The music sidebar
 * reads it too, to keep the section you came from marked while you look at a
 * project or an artist.
 */

export interface NavEntry {
  route: string;
  sidebarMode: SidebarMode;
  spaceId: string | null;
  channelId: string | null;
  musicView: MusicView;
  musicDetailId: string | null;
  dmPubkey: string | null;
}

const MAX_HISTORY = 100;
/** State changes land in bursts (mode, view, route); wait for them to settle. */
const SETTLE_MS = 150;
/** After a restore, ignore the state changes the restore itself causes. */
const RESTORE_QUIET_MS = 300;

// Module-level state: persists across re-renders, resets on page refresh.
const stack: NavEntry[] = [];
let cursor = -1;
let skipUntil = 0;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const getVersion = () => version;

/** Test hook: start from an empty history. */
export function resetNavigationHistory() {
  stack.length = 0;
  cursor = -1;
  skipUntil = 0;
  emit();
}

export function isSameEntry(a: NavEntry, b: NavEntry): boolean {
  return (
    a.route === b.route &&
    a.sidebarMode === b.sidebarMode &&
    a.spaceId === b.spaceId &&
    a.channelId === b.channelId &&
    a.musicView === b.musicView &&
    a.musicDetailId === b.musicDetailId &&
    a.dmPubkey === b.dmPubkey
  );
}

/** Music views that show one thing (a project, an artist, a folder) rather
 *  than a section of the library. */
export const MUSIC_DETAIL_VIEWS: ReadonlySet<MusicView> = new Set<MusicView>([
  "album-detail",
  "artist-detail",
  "folder-detail",
  "published-folder",
  "project-history",
]);

/** The music section renders on the index route while the sidebar is in
 *  music mode; `/discover`, a profile or a space are somewhere else. */
export function isMusicSection(entry: NavEntry): boolean {
  return entry.route === "/" && entry.sidebarMode === "music";
}

export function isMusicDetail(entry: NavEntry): boolean {
  return isMusicSection(entry) && MUSIC_DETAIL_VIEWS.has(entry.musicView);
}

/** Share-link routes only resolve a link and forward to the music section.
 *  Recording them would make Back land on a page that sends you forward. */
function isTransientRoute(route: string): boolean {
  return /^\/music\/(album|track|playlist)\//.test(route);
}

/** Index of the entry Back goes to, or -1. `current` may not be recorded yet
 *  (it is recorded once it settles), in which case the newest entry IS the
 *  previous page. */
export function previousIndex(entries: readonly NavEntry[], at: number, current: NavEntry): number {
  if (at < 0) return -1;
  return isSameEntry(entries[at], current) ? at - 1 : at;
}

/**
 * Where a music detail page was opened from: the nearest earlier entry that
 * is not itself a detail page. Walking project → artist → project keeps
 * pointing at the list (or the outside page) the walk started from.
 */
export function originOf(entries: readonly NavEntry[], at: number, current: NavEntry): NavEntry | null {
  for (let i = previousIndex(entries, at, current); i >= 0; i--) {
    if (!isMusicDetail(entries[i])) return entries[i];
  }
  return null;
}

const MUSIC_LABELS: Record<MusicView, string> = {
  home: "Home",
  explore: "Explore",
  "for-you": "Explore",
  "recently-added": "Recently Added",
  favorites: "Favorites",
  artists: "Artists",
  albums: "Projects",
  songs: "Songs",
  folders: "Folders",
  "my-uploads": "My Music",
  search: "search",
  insights: "Insights",
  "listen-requests": "Listen Requests",
  "album-detail": "project",
  "artist-detail": "artist",
  "folder-detail": "folder",
  "published-folder": "folder",
  "project-history": "history",
};

/** A short name for an entry, for "Back to …". Null when there is no good
 *  name; the caller then says just "Back". */
export function describeEntry(entry: NavEntry, spaceName?: string | null): string | null {
  const { route } = entry;
  if (route.startsWith("/discover")) return "Discover";
  if (route.startsWith("/profile/")) return "profile";
  if (route.startsWith("/dm")) return "Messages";
  if (route.startsWith("/settings")) return "Settings";
  if (route.startsWith("/article/")) return "article";
  if (route !== "/") return null;
  switch (entry.sidebarMode) {
    case "music":
      return MUSIC_LABELS[entry.musicView] ?? null;
    case "messages":
      return "Messages";
    case "spaces":
      return entry.spaceId ? (spaceName ?? "space") : "Feed";
    default:
      return null;
  }
}

function restore(entry: NavEntry, dispatch: AppDispatch, navigate: NavigateFunction) {
  // Don't record the state changes this restore is about to cause.
  skipUntil = Date.now() + RESTORE_QUIET_MS;
  dispatch(setSidebarMode(entry.sidebarMode));
  dispatch(setActiveSpace(entry.spaceId));
  dispatch(setActiveChannel(entry.channelId));
  dispatch(setActiveConversation(entry.dmPubkey));
  dispatch(restoreMusicView({ view: entry.musicView, detailId: entry.musicDetailId }));
  navigate(entry.route);
}

/** The route + state combination on screen right now. */
function useCurrentEntry(): NavEntry {
  const location = useLocation();
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const spaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const channelId = useAppSelector((s) => s.spaces.activeChannelId);
  const musicView = useAppSelector((s) => s.music.activeView);
  const musicDetailId = useAppSelector((s) => s.music.activeDetailId);
  const dmPubkey = useAppSelector((s) => s.dm.activeConversation);
  const route = location.pathname;
  return useMemo(
    () => ({ route, sidebarMode, spaceId, channelId, musicView, musicDetailId, dmPubkey }),
    [route, sidebarMode, spaceId, channelId, musicView, musicDetailId, dmPubkey],
  );
}

/**
 * Read the history: where Back goes, where a detail page was opened from,
 * and the action itself. Safe to call from any number of components; it does
 * not record (the top bar does, through `useNavigationHistory`).
 */
export function useNavigationTrail() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const current = useCurrentEntry();
  useSyncExternalStore(subscribe, getVersion);

  const prevAt = previousIndex(stack, cursor, current);
  const previous = prevAt >= 0 ? stack[prevAt] : null;
  const origin = originOf(stack, cursor, current);
  const canGoForward = cursor < stack.length - 1;

  /** Returns false when there is nowhere to go back to. */
  const goBack = useCallback((): boolean => {
    const at = previousIndex(stack, cursor, current);
    if (at < 0) return false;
    cursor = at;
    restore(stack[at], dispatch, navigate);
    emit();
    return true;
  }, [current, dispatch, navigate]);

  const goForward = useCallback(() => {
    if (cursor >= stack.length - 1) return;
    cursor++;
    restore(stack[cursor], dispatch, navigate);
    emit();
  }, [dispatch, navigate]);

  return { previous, origin, canGoBack: previous !== null, canGoForward, goBack, goForward };
}

/**
 * Record navigation and expose back/forward. Call it from exactly one
 * long-lived component (the top bar); everything else reads the trail.
 */
export function useNavigationHistory() {
  const current = useCurrentEntry();
  const trail = useNavigationTrail();

  // Record each settled state, collapsing the burst of updates one
  // navigation makes into a single entry.
  useEffect(() => {
    if (Date.now() < skipUntil) return;
    if (isTransientRoute(current.route)) return;

    const timeoutId = setTimeout(() => {
      const newest = stack[cursor];
      if (newest && isSameEntry(newest, current)) return;

      stack.splice(cursor + 1); // drop forward history
      stack.push(current);
      if (stack.length > MAX_HISTORY) stack.shift();
      cursor = stack.length - 1;
      emit();
    }, SETTLE_MS);

    return () => clearTimeout(timeoutId);
  }, [current]);

  return {
    canGoBack: trail.canGoBack,
    canGoForward: trail.canGoForward,
    goBack: trail.goBack,
    goForward: trail.goForward,
  };
}
