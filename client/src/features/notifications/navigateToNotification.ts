import type { NavigateFunction } from "react-router-dom";
import type { AppDispatch } from "@/store";
import type { InAppNotification } from "@/store/slices/notificationSlice";
import { clearChannelUnread, updateLastRead, markChannelNotificationsRead, setUnreadDivider } from "@/store/slices/notificationSlice";
import { setActiveConversation } from "@/store/slices/dmSlice";
import { setActiveSpace, setActiveChannel } from "@/store/slices/spacesSlice";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { enterClientSpace, switchSpaceChannel } from "@/lib/nostr/groupSubscriptions";
import { store } from "@/store";

/**
 * Navigate to the relevant content for a notification.
 * Shared between NotificationBell and NotificationToast.
 */
export function navigateToNotification(
  notification: InAppNotification,
  navigate: NavigateFunction,
  dispatch: AppDispatch,
  onComplete?: () => void,
): void {
  switch (notification.type) {
    case "dm": {
      const pubkey = notification.contextId;
      if (pubkey) {
        dispatch(setActiveConversation(pubkey));
        navigate(`/dm/${pubkey}`);
      }
      break;
    }

    case "follow": {
      const pubkey = notification.actorPubkey;
      if (pubkey) {
        navigate(`/profile/${pubkey}`);
      }
      break;
    }

    case "mention":
    case "chat": {
      const contextId = notification.contextId;
      if (!contextId) break;

      // contextId is "spaceId:channelPart" (e.g. "abc123:chat" or "abc123:ch_xyz")
      const colonIdx = contextId.indexOf(":");
      const spaceId = colonIdx > 0 ? contextId.slice(0, colonIdx) : contextId;
      const channelPart = colonIdx > 0 ? contextId.slice(colonIdx + 1) : null;

      const state = store.getState();
      const space = state.spaces.list.find((s) => s.id === spaceId);
      if (!space) break;

      dispatch(setSidebarMode("spaces"));
      dispatch(setActiveSpace(spaceId));
      enterClientSpace(space);

      if (channelPart) {
        const channelId = `${spaceId}:${channelPart}`;
        dispatch(setActiveChannel(channelId));

        // Capture old lastRead for unread divider before clearing
        const notifState = state.notifications;
        const hasUnreads = (notifState.channelUnread[channelId] ?? 0) > 0;
        if (hasUnreads) {
          const oldTimestamp = notifState.lastReadTimestamps[channelId] ?? 0;
          dispatch(setUnreadDivider({ channelId, timestamp: oldTimestamp }));
        }

        dispatch(clearChannelUnread(channelId));
        dispatch(markChannelNotificationsRead(channelId));
        dispatch(updateLastRead({ contextId: channelId, timestamp: Math.floor(Date.now() / 1000) }));

        // Resolve channel type for subscription switching
        const spaceChannels = state.spaces.channels[spaceId];
        const channel = spaceChannels?.find((c) => c.id === channelPart);
        if (channel) {
          switchSpaceChannel(space, channel.type);
        } else {
          // channelPart is the type itself (legacy format)
          switchSpaceChannel(space, channelPart);
        }
      }

      navigate("/");
      break;
    }

    case "friend_request": {
      const pubkey = notification.actorPubkey;
      if (pubkey) {
        navigate(`/profile/${pubkey}`);
      }
      break;
    }

    case "invite": {
      // Collaboration invite: contextId is an addressable ID like "31683:pubkey:slug"
      const ctx = notification.contextId;
      if (ctx?.startsWith("31683:") || ctx?.startsWith("33123:")) {
        const parts = ctx.split(":");
        const kind = parts[0];
        const ownerPubkey = parts[1];
        const slug = parts.slice(2).join(":");
        if (kind === "33123") {
          navigate(`/music/album/${ownerPubkey}/${slug}`);
        } else {
          navigate(`/music/track/${ownerPubkey}/${slug}`);
        }
      }
      break;
    }
  }

  onComplete?.();
}
