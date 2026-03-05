import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

// ── Types ───────────────────────────────────────────────────────

export type NotificationType = "mention" | "dm" | "follow" | "chat" | "invite" | "friend_request";

export interface InAppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Pubkey of the actor (who triggered the notification) */
  actorPubkey?: string;
  /** Context for navigation (spaceId, channelId, conversationPubkey) */
  contextId?: string;
  timestamp: number;
  read?: boolean;
  /** Action button type (e.g. "follow_back", "accept_friend") */
  actionType?: "follow_back" | "accept_friend";
  /** Target pubkey for the action */
  actionTarget?: string;
}

export interface SpaceMute {
  muted: boolean;
  /** Unix ms timestamp when mute expires. Undefined = permanent. */
  muteUntil?: number;
}

export interface NotificationPreferences {
  enabled: boolean;
  mentions: boolean;
  dms: boolean;
  newFollowers: boolean;
  chatMessages: boolean;
  browserNotifications: boolean;
  sound: boolean;
  /** Do Not Disturb mode */
  dnd: boolean;
  /** DND expiry as Unix ms timestamp. Undefined = permanent. */
  dndUntil?: number;
}

const defaultPreferences: NotificationPreferences = {
  enabled: true,
  mentions: true,
  dms: true,
  newFollowers: true,
  chatMessages: true,
  browserNotifications: false,
  sound: false,
  dnd: false,
};

interface NotificationState {
  /** Unread message counts per space (aggregated across channels) */
  spaceUnread: Record<string, number>;
  /** Unread message counts per channel (key: "spaceId:channelId") */
  channelUnread: Record<string, number>;
  /** @mention counts per space */
  spaceMentions: Record<string, number>;
  /** @mention counts per channel (key: "spaceId:channelId") */
  channelMentions: Record<string, number>;
  /** In-app toast notifications */
  notifications: InAppNotification[];
  /** Per-space mute settings */
  spaceMutes: Record<string, SpaceMute>;
  /** User notification preferences */
  preferences: NotificationPreferences;
  /** Last-read timestamps per context (key: contextId, value: unix seconds) */
  lastReadTimestamps: Record<string, number>;
}

const initialState: NotificationState = {
  spaceUnread: {},
  channelUnread: {},
  spaceMentions: {},
  channelMentions: {},
  notifications: [],
  spaceMutes: {},
  preferences: defaultPreferences,
  lastReadTimestamps: {},
};

export const notificationSlice = createSlice({
  name: "notifications",
  initialState,
  reducers: {
    incrementUnread(
      state,
      action: PayloadAction<{ spaceId: string; channelId: string }>,
    ) {
      const { spaceId, channelId } = action.payload;
      state.spaceUnread[spaceId] = (state.spaceUnread[spaceId] ?? 0) + 1;
      state.channelUnread[channelId] =
        (state.channelUnread[channelId] ?? 0) + 1;
    },

    incrementMention(
      state,
      action: PayloadAction<{ spaceId: string; channelId: string }>,
    ) {
      const { spaceId, channelId } = action.payload;
      state.spaceMentions[spaceId] =
        (state.spaceMentions[spaceId] ?? 0) + 1;
      state.channelMentions[channelId] =
        (state.channelMentions[channelId] ?? 0) + 1;
    },

    clearChannelUnread(state, action: PayloadAction<string>) {
      const channelId = action.payload;
      const count = state.channelUnread[channelId] ?? 0;
      const mentionCount = state.channelMentions[channelId] ?? 0;

      // Subtract from parent space
      const spaceId = channelId.split(":")[0];
      if (spaceId && state.spaceUnread[spaceId]) {
        state.spaceUnread[spaceId] = Math.max(
          0,
          state.spaceUnread[spaceId] - count,
        );
        if (state.spaceUnread[spaceId] === 0) {
          delete state.spaceUnread[spaceId];
        }
      }
      if (spaceId && state.spaceMentions[spaceId]) {
        state.spaceMentions[spaceId] = Math.max(
          0,
          state.spaceMentions[spaceId] - mentionCount,
        );
        if (state.spaceMentions[spaceId] === 0) {
          delete state.spaceMentions[spaceId];
        }
      }

      delete state.channelUnread[channelId];
      delete state.channelMentions[channelId];
    },

    clearSpaceUnread(state, action: PayloadAction<string>) {
      const spaceId = action.payload;
      delete state.spaceUnread[spaceId];
      delete state.spaceMentions[spaceId];

      // Clear all channels belonging to this space
      const prefix = `${spaceId}:`;
      for (const key of Object.keys(state.channelUnread)) {
        if (key.startsWith(prefix)) delete state.channelUnread[key];
      }
      for (const key of Object.keys(state.channelMentions)) {
        if (key.startsWith(prefix)) delete state.channelMentions[key];
      }
    },

    addNotification(state, action: PayloadAction<InAppNotification>) {
      state.notifications.push(action.payload);
      // Cap at 50 notifications in memory
      if (state.notifications.length > 50) {
        state.notifications = state.notifications.slice(-50);
      }
    },

    removeNotification(state, action: PayloadAction<string>) {
      state.notifications = state.notifications.filter(
        (n) => n.id !== action.payload,
      );
    },

    markNotificationRead(state, action: PayloadAction<string>) {
      const n = state.notifications.find((n) => n.id === action.payload);
      if (n) n.read = true;
    },

    /** Mark all DM notifications from a given pubkey as read.
     *  Called when the user opens a DM conversation directly. */
    markDMNotificationsRead(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      for (const n of state.notifications) {
        if (n.type === "dm" && n.contextId === pubkey && !n.read) {
          n.read = true;
        }
      }
    },

    markAllNotificationsRead(state) {
      for (const n of state.notifications) {
        n.read = true;
      }
    },

    clearAllNotifications(state) {
      state.notifications = [];
    },

    setSpaceMute(
      state,
      action: PayloadAction<{ spaceId: string; mute: SpaceMute }>,
    ) {
      state.spaceMutes[action.payload.spaceId] = action.payload.mute;
    },

    removeSpaceMute(state, action: PayloadAction<string>) {
      delete state.spaceMutes[action.payload];
    },

    setPreferences(state, action: PayloadAction<Partial<NotificationPreferences>>) {
      state.preferences = { ...state.preferences, ...action.payload };
    },

    updateLastRead(
      state,
      action: PayloadAction<{ contextId: string; timestamp: number }>,
    ) {
      state.lastReadTimestamps[action.payload.contextId] =
        action.payload.timestamp;
    },

    restoreNotificationState(
      state,
      action: PayloadAction<{
        spaceUnread?: Record<string, number>;
        channelUnread?: Record<string, number>;
        spaceMentions?: Record<string, number>;
        channelMentions?: Record<string, number>;
        lastReadTimestamps?: Record<string, number>;
        spaceMutes?: Record<string, SpaceMute>;
        preferences?: NotificationPreferences;
      }>,
    ) {
      const p = action.payload;
      if (p.spaceUnread) state.spaceUnread = p.spaceUnread;
      if (p.channelUnread) state.channelUnread = p.channelUnread;
      if (p.spaceMentions) state.spaceMentions = p.spaceMentions;
      if (p.channelMentions) state.channelMentions = p.channelMentions;
      if (p.lastReadTimestamps)
        state.lastReadTimestamps = p.lastReadTimestamps;
      if (p.spaceMutes) state.spaceMutes = p.spaceMutes;
      if (p.preferences) state.preferences = p.preferences;
    },
  },
});

export const {
  incrementUnread,
  incrementMention,
  clearChannelUnread,
  clearSpaceUnread,
  addNotification,
  removeNotification,
  markNotificationRead,
  markDMNotificationsRead,
  markAllNotificationsRead,
  clearAllNotifications,
  setSpaceMute,
  removeSpaceMute,
  setPreferences,
  updateLastRead,
  restoreNotificationState,
} = notificationSlice.actions;
