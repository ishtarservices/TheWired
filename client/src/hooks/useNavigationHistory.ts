import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setSidebarMode } from "../store/slices/uiSlice";
import { setActiveSpace, setActiveChannel } from "../store/slices/spacesSlice";
import { setMusicView, setActiveDetailId } from "../store/slices/musicSlice";
import { setActiveConversation } from "../store/slices/dmSlice";
import type { MusicView } from "../types/music";

interface NavEntry {
  route: string;
  sidebarMode: "spaces" | "music" | "messages";
  spaceId: string | null;
  channelId: string | null;
  musicView: MusicView;
  musicDetailId: string | null;
  dmPubkey: string | null;
}

const MAX_HISTORY = 100;

// Module-level state — persists across re-renders, resets on page refresh
const stack: NavEntry[] = [];
let cursor = -1;

function isSameEntry(a: NavEntry, b: NavEntry): boolean {
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

export function useNavigationHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const spaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const channelId = useAppSelector((s) => s.spaces.activeChannelId);
  const musicView = useAppSelector((s) => s.music.activeView);
  const musicDetailId = useAppSelector((s) => s.music.activeDetailId);
  const dmPubkey = useAppSelector((s) => s.dm.activeConversation);

  const skipUntilRef = useRef(0);
  const [, setTick] = useState(0);

  // Record navigation state changes with debounce to collapse rapid updates
  useEffect(() => {
    if (Date.now() < skipUntilRef.current) return;

    const entry: NavEntry = {
      route: location.pathname,
      sidebarMode,
      spaceId,
      channelId,
      musicView,
      musicDetailId,
      dmPubkey,
    };

    const timeoutId = setTimeout(() => {
      const current = stack[cursor];
      if (current && isSameEntry(current, entry)) return;

      // Truncate forward history
      stack.splice(cursor + 1);
      stack.push(entry);
      if (stack.length > MAX_HISTORY) {
        stack.shift();
      }
      cursor = stack.length - 1;
      setTick((t) => t + 1);
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [location.pathname, sidebarMode, spaceId, channelId, musicView, musicDetailId, dmPubkey]);

  const restoreEntry = useCallback(
    (entry: NavEntry) => {
      // Skip recording for 300ms while state settles from restoration
      skipUntilRef.current = Date.now() + 300;

      dispatch(setSidebarMode(entry.sidebarMode));
      dispatch(setActiveSpace(entry.spaceId));
      dispatch(setActiveChannel(entry.channelId));
      dispatch(setActiveConversation(entry.dmPubkey));

      if (entry.musicDetailId) {
        dispatch(
          setActiveDetailId({
            view: entry.musicView,
            id: entry.musicDetailId,
          }),
        );
      } else {
        dispatch(setMusicView(entry.musicView));
      }

      navigate(entry.route);
    },
    [dispatch, navigate],
  );

  const goBack = useCallback(() => {
    if (cursor <= 0) return;
    cursor--;
    restoreEntry(stack[cursor]);
    setTick((t) => t + 1);
  }, [restoreEntry]);

  const goForward = useCallback(() => {
    if (cursor >= stack.length - 1) return;
    cursor++;
    restoreEntry(stack[cursor]);
    setTick((t) => t + 1);
  }, [restoreEntry]);

  return {
    canGoBack: cursor > 0,
    canGoForward: cursor < stack.length - 1,
    goBack,
    goForward,
  };
}
