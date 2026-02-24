import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

type ActiveTab = "chat" | "reels" | "longform";
type SidebarMode = "spaces" | "music";

interface UIState {
  sidebarExpanded: boolean;
  activeTab: ActiveTab;
  memberListVisible: boolean;
  notifications: AppNotification[];
  sidebarMode: SidebarMode;
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
  memberListVisible: true,
  notifications: [],
  sidebarMode: "spaces",
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
    toggleMemberList(state) {
      state.memberListVisible = !state.memberListVisible;
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
    },
  },
});

export const {
  toggleSidebar,
  setSidebarExpanded,
  setActiveTab,
  toggleMemberList,
  addNotification,
  removeNotification,
  setSidebarMode,
} = uiSlice.actions;
