import type { NavigateFunction } from "react-router-dom";
import type { AppDispatch } from "@/store";
import type { InAppNotification } from "@/store/slices/notificationSlice";
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
      // Future: open JoinSpaceModal with pre-filled code
      break;
    }
  }

  onComplete?.();
}
