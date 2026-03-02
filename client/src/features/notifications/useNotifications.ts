import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import type { NotificationPreferences, SpaceMute } from "@/store/slices/notificationSlice";

/** Unread count for a specific space (aggregated across all channels) */
export function useSpaceUnread(spaceId: string | undefined): number {
  return useAppSelector((s) =>
    spaceId ? s.notifications.spaceUnread[spaceId] ?? 0 : 0,
  );
}

/** @mention count for a specific space */
export function useSpaceMentions(spaceId: string | undefined): number {
  return useAppSelector((s) =>
    spaceId ? s.notifications.spaceMentions[spaceId] ?? 0 : 0,
  );
}

/** Unread count for a specific channel (key = "spaceId:channelId") */
export function useChannelUnread(contextId: string | undefined): number {
  return useAppSelector((s) =>
    contextId ? s.notifications.channelUnread[contextId] ?? 0 : 0,
  );
}

/** @mention count for a specific channel */
export function useChannelMentions(contextId: string | undefined): number {
  return useAppSelector((s) =>
    contextId ? s.notifications.channelMentions[contextId] ?? 0 : 0,
  );
}

/** Whether a space is currently muted (checking expiry) */
export function useSpaceMuted(spaceId: string | undefined): boolean {
  const mute = useAppSelector((s) =>
    spaceId ? s.notifications.spaceMutes[spaceId] : undefined,
  );
  if (!mute?.muted) return false;
  if (mute.muteUntil && mute.muteUntil < Date.now()) return false;
  return true;
}

/** Full mute info for a space */
export function useSpaceMuteInfo(spaceId: string | undefined): SpaceMute | undefined {
  return useAppSelector((s) =>
    spaceId ? s.notifications.spaceMutes[spaceId] : undefined,
  );
}

/** Total unread count across all spaces */
export function useTotalUnread(): number {
  const spaceUnread = useAppSelector((s) => s.notifications.spaceUnread);
  return useMemo(
    () => Object.values(spaceUnread).reduce((sum, n) => sum + n, 0),
    [spaceUnread],
  );
}

/** Current notification preferences */
export function useNotificationPreferences(): NotificationPreferences {
  return useAppSelector((s) => s.notifications.preferences);
}

/** In-app notification list */
export function useInAppNotifications() {
  return useAppSelector((s) => s.notifications.notifications);
}

/** Count of unread in-app notifications */
export function useUnreadNotificationCount(): number {
  const notifications = useAppSelector((s) => s.notifications.notifications);
  return useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );
}
