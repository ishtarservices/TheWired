import { useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, AtSign, MessageCircle, UserPlus, Link2, X, CheckCheck, Trash2, HeartHandshake } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  removeNotification,
  markNotificationRead,
  markAllNotificationsRead,
  clearAllNotifications,
  type InAppNotification,
  type NotificationType,
} from "@/store/slices/notificationSlice";
import { useInAppNotifications, useUnreadNotificationCount } from "./useNotifications";
import { useClickOutside } from "@/hooks/useClickOutside";
import { navigateToNotification } from "./navigateToNotification";
import { followUser } from "@/lib/nostr/follow";
import { acceptFriendRequestAction } from "@/lib/nostr/friendRequest";

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

export function NotificationBell() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifications = useInAppNotifications();
  const unreadCount = useUnreadNotificationCount();

  const handleClose = useCallback(() => setOpen(false), []);
  useClickOutside(dropdownRef, handleClose, open);

  const handleToggle = () => {
    setOpen((v) => !v);
  };

  const handleMarkAllRead = () => {
    dispatch(markAllNotificationsRead());
  };

  const handleClearAll = () => {
    dispatch(clearAllNotifications());
  };

  const handleClickNotification = (n: InAppNotification) => {
    if (!n.read) {
      dispatch(markNotificationRead(n.id));
    }
    navigateToNotification(n, navigate, dispatch, handleClose);
  };

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dispatch(removeNotification(id));
  };

  // Show newest first
  const sorted = [...notifications].reverse();

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={handleToggle}
        className={cn(
          "relative rounded-xl p-2 transition-colors",
          open
            ? "bg-surface-hover text-heading"
            : "text-soft hover:bg-surface hover:text-heading",
        )}
        title="Notifications"
      >
        <Bell size={15} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-80 max-h-[420px] rounded-xl shadow-[var(--shadow-elevated)] animate-fade-in-up flex flex-col overflow-hidden border border-border-light bg-panel backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-surface/80">
            <span className="text-xs font-semibold text-heading tracking-wide uppercase">Notifications</span>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <>
                  <button
                    onClick={handleMarkAllRead}
                    className="rounded-md p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
                    title="Mark all as read"
                  >
                    <CheckCheck size={13} />
                  </button>
                  <button
                    onClick={handleClearAll}
                    className="rounded-md p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
                    title="Clear all"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted">
                <div className="rounded-full bg-surface p-3 mb-3">
                  <Bell size={20} className="text-faint" />
                </div>
                <span className="text-xs font-medium text-soft">All clear</span>
                <span className="text-[11px] text-faint mt-0.5">No new notifications</span>
              </div>
            ) : (
              sorted.map((n) => (
                <NotificationRow
                  key={n.id}
                  notification={n}
                  onClick={() => handleClickNotification(n)}
                  onDismiss={(e) => handleDismiss(e, n.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  notification,
  onClick,
  onDismiss,
}: {
  notification: InAppNotification;
  onClick: () => void;
  onDismiss: (e: React.MouseEvent) => void;
}) {
  const Icon = TYPE_ICONS[notification.type] ?? MessageCircle;
  const iconColor = TYPE_COLORS[notification.type] ?? "text-soft";
  const isRead = notification.read;
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

  const handleFollowBack = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (notification.actionTarget) {
      followUser(notification.actionTarget);
    }
  };

  const handleAcceptFriend = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (notification.actionTarget) {
      acceptFriendRequestAction(notification.actionTarget);
    }
  };

  const timeAgo = formatTimeAgo(notification.timestamp);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "group flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover",
        !isRead && "bg-primary/[0.04]",
      )}
    >
      {/* Unread dot */}
      <div className="mt-1.5 flex shrink-0 items-center">
        <div
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-opacity",
            isRead ? "opacity-0" : "bg-primary opacity-100",
          )}
        />
      </div>

      {/* Icon */}
      <Icon size={14} className={cn("mt-0.5 shrink-0", iconColor)} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className={cn("text-xs font-medium", isRead ? "text-soft" : "text-heading")}>
          {notification.title}
        </p>
        <p className="mt-0.5 text-[11px] text-muted line-clamp-2">{notification.body}</p>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-[10px] text-faint">{timeAgo}</span>
          {showFollowBack && (
            <button
              onClick={handleFollowBack}
              className="rounded-md bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/30 transition-colors"
            >
              Follow Back
            </button>
          )}
          {showAcceptFriend && (
            <button
              onClick={handleAcceptFriend}
              className="rounded-md bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/30 transition-colors"
            >
              Accept
            </button>
          )}
        </div>
      </div>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="shrink-0 rounded-md p-0.5 text-faint opacity-0 transition-all group-hover:opacity-100 hover:text-heading hover:bg-surface-hover"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
