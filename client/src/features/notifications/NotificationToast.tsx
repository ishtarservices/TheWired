import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { X, AtSign, MessageCircle, UserPlus, Link2, HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { removeNotification, markNotificationRead, type InAppNotification, type NotificationType } from "@/store/slices/notificationSlice";
import { useInAppNotifications } from "./useNotifications";
import { showBrowserNotification } from "./browserNotify";
import { navigateToNotification } from "./navigateToNotification";
import { followUser } from "@/lib/nostr/follow";
import { acceptFriendRequestAction } from "@/lib/nostr/friendRequest";

const AUTO_DISMISS_MS = 5_000;
const MAX_VISIBLE = 5;

const TYPE_ICONS: Record<NotificationType, typeof AtSign> = {
  mention: AtSign,
  dm: MessageCircle,
  follow: UserPlus,
  chat: MessageCircle,
  invite: Link2,
  friend_request: HeartHandshake,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  mention: "text-primary",
  dm: "text-primary",
  follow: "text-primary-soft",
  chat: "text-soft",
  invite: "text-primary",
  friend_request: "text-primary",
};

export function NotificationToastStack() {
  const notifications = useInAppNotifications();
  // Track IDs that have been dismissed from the toast view only.
  // This lets actionable notifications stay in the bell dropdown
  // even after the toast is closed.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const hideToast = useCallback((id: string) => {
    setHiddenIds((prev) => new Set(prev).add(id));
  }, []);

  const visible = notifications
    .filter((n) => !hiddenIds.has(n.id))
    .slice(-MAX_VISIBLE);

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {visible.map((n) => (
        <Toast key={n.id} notification={n} onHideToast={hideToast} />
      ))}
    </div>
  );
}

function Toast({
  notification,
  onHideToast,
}: {
  notification: InAppNotification;
  onHideToast: (id: string) => void;
}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const Icon = TYPE_ICONS[notification.type] ?? MessageCircle;
  const iconColor = TYPE_COLORS[notification.type] ?? "text-soft";
  const followList = useAppSelector((s) => s.identity.followList);
  const friendRequests = useAppSelector((s) => s.friendRequests.requests);

  const showFollowBack =
    notification.actionType === "follow_back" &&
    notification.actionTarget &&
    !followList.includes(notification.actionTarget);

  const showAcceptFriend =
    notification.actionType === "accept_friend" &&
    notification.actionTarget &&
    friendRequests.some(
      (r) =>
        r.pubkey === notification.actionTarget &&
        r.direction === "incoming" &&
        r.status === "pending",
    );

  // Persistent notifications stay in Redux for the bell dropdown.
  // The toast hides itself locally instead of removing from Redux.
  const isPersistent =
    notification.actionType === "accept_friend" ||
    notification.actionType === "follow_back" ||
    notification.type === "dm" ||
    notification.type === "mention" ||
    notification.type === "chat";

  // Actionable notifications (friend req, follow back) get an extended toast
  // so the user has time to act. DMs and others use the short timer.
  const isActionable =
    notification.actionType === "accept_friend" ||
    notification.actionType === "follow_back";

  useEffect(() => {
    // Fire browser notification once on mount
    showBrowserNotification(notification.title, notification.body);

    const timeout = isActionable ? AUTO_DISMISS_MS * 3 : AUTO_DISMISS_MS;

    if (isPersistent) {
      // Hide toast visually but keep notification in Redux for the bell
      timerRef.current = setTimeout(() => {
        onHideToast(notification.id);
      }, timeout);
    } else {
      // Ephemeral — remove from Redux entirely
      timerRef.current = setTimeout(() => {
        dispatch(removeNotification(notification.id));
      }, timeout);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dispatch, notification.id, notification.title, notification.body, isPersistent, isActionable, onHideToast]);

  const handleClick = () => {
    if (isPersistent) {
      // Hide toast, mark read in bell, but don't remove from Redux
      onHideToast(notification.id);
      dispatch(markNotificationRead(notification.id));
    } else {
      dispatch(removeNotification(notification.id));
    }
    navigateToNotification(notification, navigate, dispatch);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPersistent) {
      onHideToast(notification.id);
    } else {
      dispatch(removeNotification(notification.id));
    }
  };

  const handleFollowBack = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (notification.actionTarget) {
      followUser(notification.actionTarget);
      // Acted on — safe to remove everywhere
      dispatch(removeNotification(notification.id));
    }
  };

  const handleAcceptFriend = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (notification.actionTarget) {
      acceptFriendRequestAction(notification.actionTarget);
      // Acted on — safe to remove everywhere
      dispatch(removeNotification(notification.id));
    }
  };

  return (
    <div
      onClick={handleClick}
      className="pointer-events-auto card-glass rounded-xl px-4 py-3 max-w-xs animate-slide-up cursor-pointer hover:bg-surface-hover transition-colors"
    >
      <div className="flex items-start gap-3">
        <Icon size={16} className={cn("mt-0.5 shrink-0", iconColor)} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-heading">{notification.title}</p>
          <p className="mt-0.5 text-xs text-soft line-clamp-2">{notification.body}</p>
          {showFollowBack && (
            <button
              onClick={handleFollowBack}
              className="mt-1.5 rounded-md bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/30 transition-colors"
            >
              Follow Back
            </button>
          )}
          {showAcceptFriend && (
            <button
              onClick={handleAcceptFriend}
              className="mt-1.5 rounded-md bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/30 transition-colors"
            >
              Accept
            </button>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-md p-0.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
