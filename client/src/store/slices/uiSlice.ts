import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type ActiveTab = "chat" | "reels" | "longform";
type SidebarMode = "spaces" | "music" | "messages";

export type PanelContext = "space" | "music" | "dm" | "profile" | "none";

interface RightPanelState {
  /** Per-context visibility — closing in one context doesn't affect others */
  openByContext: Record<PanelContext, boolean>;
  /** Per-context active tab — preserved across context switches */
  activeTabByContext: Record<PanelContext, string>;
  /** Temporary override — forces the panel to show a different context
   *  (e.g. opening queue from playback bar while in spaces mode).
   *  Cleared on sidebar mode change or explicit panel toggle. */
  contextOverride: PanelContext | null;
}

interface UIState {
  sidebarExpanded: boolean;
  activeTab: ActiveTab;
  notifications: AppNotification[];
  sidebarMode: SidebarMode;
  rightPanel: RightPanelState;
}

interface AppNotification {
  id: string;
  message: string;
  type: "info" | "error" | "success";
  timestamp: number;
}

const initialState: UIState = {
  sidebarExpanded: true,
  activeTab: "chat",
  notifications: [],
  sidebarMode: "spaces",
  rightPanel: {
    openByContext: {
      space: true,
      music: false,
      dm: false,
      profile: false,
      none: false,
    },
    activeTabByContext: {
      space: "members",
      music: "queue",
      dm: "profile",
      profile: "info",
      none: "",
    },
    contextOverride: null,
  },
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarExpanded = !state.sidebarExpanded;
    },
    setSidebarExpanded(state, action: PayloadAction<boolean>) {
      state.sidebarExpanded = action.payload;
    },
    setActiveTab(state, action: PayloadAction<ActiveTab>) {
      state.activeTab = action.payload;
    },
    addNotification(state, action: PayloadAction<AppNotification>) {
      state.notifications.push(action.payload);
    },
    removeNotification(state, action: PayloadAction<string>) {
      state.notifications = state.notifications.filter(
        (n) => n.id !== action.payload,
      );
    },
    setSidebarMode(state, action: PayloadAction<SidebarMode>) {
      state.sidebarMode = action.payload;
      // Clear override when switching sidebar modes
      state.rightPanel.contextOverride = null;
    },

    // ── Right panel actions ──

    /** Toggle visibility for a given context */
    toggleRightPanel(state, action: PayloadAction<PanelContext>) {
      const ctx = action.payload;
      state.rightPanel.openByContext[ctx] =
        !state.rightPanel.openByContext[ctx];
      // Clear override when user explicitly toggles
      state.rightPanel.contextOverride = null;
    },
    /** Explicitly set open/closed for a context */
    setRightPanelOpen(
      state,
      action: PayloadAction<{ context: PanelContext; open: boolean }>,
    ) {
      state.rightPanel.openByContext[action.payload.context] =
        action.payload.open;
    },
    /** Set the active tab for a context */
    setRightPanelTab(
      state,
      action: PayloadAction<{ context: PanelContext; tab: string }>,
    ) {
      state.rightPanel.activeTabByContext[action.payload.context] =
        action.payload.tab;
    },
    /** Open the panel to a specific tab (combined action).
     *  Sets contextOverride so this works even from a different sidebar mode
     *  (e.g. opening queue from playback bar while in spaces). */
    openRightPanelToTab(
      state,
      action: PayloadAction<{ context: PanelContext; tab: string }>,
    ) {
      const { context, tab } = action.payload;
      state.rightPanel.openByContext[context] = true;
      state.rightPanel.activeTabByContext[context] = tab;
      state.rightPanel.contextOverride = context;
    },
  },
});

export const {
  toggleSidebar,
  setSidebarExpanded,
  setActiveTab,
  addNotification,
  removeNotification,
  setSidebarMode,
  toggleRightPanel,
  setRightPanelOpen,
  setRightPanelTab,
  openRightPanelToTab,
} = uiSlice.actions;
