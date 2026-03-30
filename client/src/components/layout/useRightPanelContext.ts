import { useMemo, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import {
  toggleRightPanel,
  setRightPanelTab,
  type PanelContext,
} from "@/store/slices/uiSlice";

export interface PanelTab {
  id: string;
  label: string;
}

interface RightPanelContextResult {
  context: PanelContext;
  isOpen: boolean;
  activeTab: string;
  tabs: PanelTab[];
  toggle: () => void;
  setTab: (tab: string) => void;
}

const SPACE_TABS: PanelTab[] = [
  { id: "members", label: "Members" },
  { id: "info", label: "Info" },
];

const MUSIC_TABS: PanelTab[] = [
  { id: "queue", label: "Queue" },
  { id: "details", label: "Details" },
];

const DM_TABS: PanelTab[] = [{ id: "profile", label: "Profile" }];

const PROFILE_TABS: PanelTab[] = [{ id: "info", label: "Connections" }];

const DISCOVER_TABS: PanelTab[] = [{ id: "preview", label: "Preview" }];

const EMPTY_TABS: PanelTab[] = [];

const TABS_BY_CONTEXT: Record<PanelContext, PanelTab[]> = {
  space: SPACE_TABS,
  music: MUSIC_TABS,
  dm: DM_TABS,
  profile: PROFILE_TABS,
  discover: DISCOVER_TABS,
  none: EMPTY_TABS,
};

function resolveContext(
  pathname: string,
  sidebarMode: string,
  activeSpaceId: string | null,
  activeConversation: string | null,
): PanelContext {
  // Route-level overrides take priority
  if (pathname === "/settings" || pathname === "/relays") return "none";
  if (pathname === "/discover") return "discover";
  if (pathname.match(/^\/profile\/[0-9a-f]+$/)) return "profile";
  if (pathname.startsWith("/dm")) {
    // Only show DM panel when a conversation is active
    if (pathname.match(/^\/dm\/[0-9a-f]+$/) || activeConversation)
      return "dm";
    return "none";
  }

  // Sidebar-mode based
  if (sidebarMode === "music") return "music";
  if (sidebarMode === "messages") {
    return activeConversation ? "dm" : "none";
  }
  if (sidebarMode === "spaces" && activeSpaceId) return "space";

  return "none";
}

export function useRightPanelContext(): RightPanelContextResult {
  const dispatch = useAppDispatch();
  const { pathname } = useLocation();
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeConversation = useAppSelector((s) => s.dm.activeConversation);
  const rightPanel = useAppSelector((s) => s.ui.rightPanel);

  const naturalContext = useMemo(
    () =>
      resolveContext(pathname, sidebarMode, activeSpaceId, activeConversation),
    [pathname, sidebarMode, activeSpaceId, activeConversation],
  );

  // Override takes priority (e.g. queue opened from playback bar while in spaces)
  const override = rightPanel.contextOverride;
  const context =
    override && override !== "none" && rightPanel.openByContext[override]
      ? override
      : naturalContext;

  const isOpen = rightPanel.openByContext[context];
  const activeTab = rightPanel.activeTabByContext[context];
  const tabs = TABS_BY_CONTEXT[context];

  const toggle = useCallback(() => {
    if (override && override !== naturalContext) {
      // Override is active — dismiss it to return to the natural context
      // (rather than toggling the overridden context's open state)
      dispatch(toggleRightPanel(override));
    } else {
      dispatch(toggleRightPanel(naturalContext));
    }
  }, [dispatch, override, naturalContext]);

  const setTab = useCallback(
    (tab: string) => {
      dispatch(setRightPanelTab({ context, tab }));
    },
    [dispatch, context],
  );

  return { context, isOpen, activeTab, tabs, toggle, setTab };
}
