import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import { decode } from "nostr-tools/nip19";
import { store } from "../../store";
import {
  incrementUnread,
  incrementMention,
  addNotification,
  type NotificationType,
} from "../../store/slices/notificationSlice";
import { addKnownFollower } from "../../store/slices/identitySlice";
import { showBrowserNotification } from "../../features/notifications/browserNotify";
import { profileCache } from "./profileCache";

/**
 * Evaluate an incoming event for notification side-effects.
 * Called from eventPipeline after indexEvent().
 */
export function evaluateNotification(event: NostrEvent): void {
  const state = store.getState();
  const myPubkey = state.identity.pubkey;
  if (!myPubkey) return;

  // Skip own events
  if (event.pubkey === myPubkey) return;

  const prefs = state.notifications.preferences;

  // Global kill switch or DND
  if (!prefs.enabled) return;
  if (prefs.dnd) {
    if (!prefs.dndUntil || prefs.dndUntil > Date.now()) return;
  }

  // Check user-level mute list
  const muteList = state.identity.muteList;
  if (muteList.some((m) => m.type === "pubkey" && m.value === event.pubkey)) {
    return;
  }

  switch (event.kind) {
    case EVENT_KINDS.CHAT_MESSAGE:
      evaluateChatMessage(event, myPubkey, prefs.chatMessages, prefs.mentions);
      break;
    case EVENT_KINDS.FOLLOW_LIST:
      evaluateFollowList(event, myPubkey, prefs.newFollowers);
      break;
  }
}

/**
 * Evaluate a DM for notification (called separately from handleGiftWrap).
 */
export function evaluateDMNotification(senderPubkey: string, content: string): void {
  const state = store.getState();
  const myPubkey = state.identity.pubkey;
  if (!myPubkey || senderPubkey === myPubkey) return;

  const prefs = state.notifications.preferences;
  if (!prefs.enabled || !prefs.dms) return;
  if (prefs.dnd && (!prefs.dndUntil || prefs.dndUntil > Date.now())) return;

  // Check mute list
  if (state.identity.muteList.some((m) => m.type === "pubkey" && m.value === senderPubkey)) {
    return;
  }

  const preview = content.length > 80 ? content.slice(0, 80) + "..." : content;

  store.dispatch(
    addNotification({
      id: `dm-${senderPubkey}-${Date.now()}`,
      type: "dm",
      title: "New direct message",
      body: preview,
      actorPubkey: senderPubkey,
      contextId: senderPubkey,
      timestamp: Date.now(),
    }),
  );

  // Fire browser/OS notification immediately (only shows when app is not focused)
  if (prefs.browserNotifications) {
    showBrowserNotification("New direct message", preview);
  }
}

/**
 * Evaluate an incoming friend request for notification.
 */
export function evaluateFriendRequestNotification(
  senderPubkey: string,
  message: string,
): void {
  const state = store.getState();
  const myPubkey = state.identity.pubkey;
  if (!myPubkey || senderPubkey === myPubkey) return;

  const prefs = state.notifications.preferences;
  if (!prefs.enabled) return;
  if (prefs.dnd && (!prefs.dndUntil || prefs.dndUntil > Date.now())) return;

  if (state.identity.muteList.some((m) => m.type === "pubkey" && m.value === senderPubkey)) {
    return;
  }

  const body = message
    ? message.length > 80 ? message.slice(0, 80) + "..." : message
    : "wants to be your friend";

  store.dispatch(
    addNotification({
      id: `friend-req-${senderPubkey}`,
      type: "friend_request",
      title: "Friend request",
      body,
      actorPubkey: senderPubkey,
      timestamp: Date.now(),
      actionType: "accept_friend",
      actionTarget: senderPubkey,
    }),
  );

  // Fire browser/OS notification (only shows when app is not focused)
  if (prefs.browserNotifications) {
    showBrowserNotification("Friend request", body);
  }
}

/**
 * Evaluate an incoming friend request acceptance for notification.
 */
export function evaluateFriendAcceptNotification(
  senderPubkey: string,
): void {
  const state = store.getState();
  const myPubkey = state.identity.pubkey;
  if (!myPubkey || senderPubkey === myPubkey) return;

  const prefs = state.notifications.preferences;
  if (!prefs.enabled) return;
  if (prefs.dnd && (!prefs.dndUntil || prefs.dndUntil > Date.now())) return;

  const body = `${getDisplayName(senderPubkey)} accepted your friend request`;

  store.dispatch(
    addNotification({
      id: `friend-accept-${senderPubkey}-${Date.now()}`,
      type: "friend_request",
      title: "Friend request accepted",
      body,
      actorPubkey: senderPubkey,
      timestamp: Date.now(),
    }),
  );

  if (prefs.browserNotifications) {
    showBrowserNotification("Friend request accepted", body);
  }
}

// ── Private helpers ─────────────────────────────────────────────

function evaluateChatMessage(
  event: NostrEvent,
  myPubkey: string,
  chatEnabled: boolean,
  mentionsEnabled: boolean,
): void {
  const hTag = event.tags.find((t) => t[0] === "h")?.[1];
  if (!hTag) return;

  const state = store.getState();
  const activeChannelId = state.spaces.activeChannelId;
  const activeSpaceId = state.spaces.activeSpaceId;

  // Resolve the spaceId from h-tag. The h-tag is the space group id.
  // Find which space matches this h-tag.
  const space = state.spaces.list.find((s) => s.id === hTag);
  if (!space) return;

  const spaceId = space.id;

  // Check space mute
  const spaceMute = state.notifications.spaceMutes[spaceId];
  if (spaceMute?.muted) {
    if (!spaceMute.muteUntil || spaceMute.muteUntil > Date.now()) return;
  }

  // Find the chat channel for this space
  const spaceChannels = state.spaces.channels[spaceId];
  const chatChannel = spaceChannels?.find((c) => c.type === "chat");
  const channelId = chatChannel
    ? `${spaceId}:${chatChannel.id}`
    : `${spaceId}:chat`;

  // Check channel-level notification override
  const channelMode = state.notifications.channelNotifSettings[channelId];
  if (channelMode === "muted") return;

  // Resolve effective mode: channel override > space settings > global prefs
  const spaceSettings = state.notifications.spaceNotifSettings[spaceId];
  const effectiveMode = channelMode && channelMode !== "default"
    ? channelMode
    : spaceSettings?.mode ?? "all";

  // Check if user is currently viewing this channel
  const isViewing =
    activeSpaceId === spaceId && activeChannelId === channelId;

  // Check for @mention (p-tag referencing our pubkey)
  const isMentioned = event.tags.some(
    (t) => t[0] === "p" && t[1] === myPubkey,
  );

  // Check suppress settings
  const suppressEveryone = spaceSettings?.suppressEveryone ?? false;
  // Detect @everyone-style mentions (no specific p-tag target, or content-based)
  const isEveryonePing = !isMentioned && event.content.includes("@everyone");

  if (suppressEveryone && isEveryonePing) return;

  // Skip events older than (or equal to) last-read timestamp.
  // Prevents double-counting on app reboot when relays replay recent messages.
  const lastRead = state.notifications.lastReadTimestamps[channelId] ?? 0;
  if (event.created_at <= lastRead) return;

  if (isMentioned && mentionsEnabled) {
    store.dispatch(incrementMention({ spaceId, channelId }));

    if (!isViewing) {
      store.dispatch(incrementUnread({ spaceId, channelId }));
    }

    dispatchToast("mention", "You were mentioned", event, channelId);
  } else if (effectiveMode === "nothing") {
    // "Nothing" mode: still track unread (gray dot) but no toast
    if (!isViewing) {
      store.dispatch(incrementUnread({ spaceId, channelId }));
    }
  } else if (effectiveMode === "mentions") {
    // "Mentions only" mode: track unread silently (no toast for regular messages)
    if (!isViewing) {
      store.dispatch(incrementUnread({ spaceId, channelId }));
    }
  } else if (!isViewing && chatEnabled) {
    // "All" mode: full notification behavior
    store.dispatch(incrementUnread({ spaceId, channelId }));
  }
}

function evaluateFollowList(
  event: NostrEvent,
  myPubkey: string,
  followEnabled: boolean,
): void {
  if (!followEnabled) return;

  // Check if our pubkey is in the follow list's p-tags
  const isFollowed = event.tags.some(
    (t) => t[0] === "p" && t[1] === myPubkey,
  );
  if (!isFollowed) return;

  const state = store.getState();

  // Dedup: if we already know this follower, skip the notification
  if (state.identity.knownFollowers.includes(event.pubkey)) return;

  // New follower — track them
  store.dispatch(addKnownFollower(event.pubkey));

  // Determine if we should show a "follow back" action
  const alreadyFollow = state.identity.followList.includes(event.pubkey);

  const followerName = getDisplayName(event.pubkey);

  store.dispatch(
    addNotification({
      id: `follow-${event.pubkey}-${event.created_at}`,
      type: "follow",
      title: "New follower",
      body: `${followerName} followed you`,
      actorPubkey: event.pubkey,
      timestamp: Date.now(),
      actionType: alreadyFollow ? undefined : "follow_back",
      actionTarget: alreadyFollow ? undefined : event.pubkey,
    }),
  );
}

/** Resolve nostr:npub1... references in text to display names */
function resolveNostrMentions(text: string): string {
  return text.replace(/nostr:(npub1[a-z0-9]+)/g, (_match, bech32: string) => {
    try {
      const { type, data } = decode(bech32);
      if (type === "npub") {
        const profile = profileCache.getCached(data as string);
        const name = profile?.display_name || profile?.name;
        if (name) return `@${name}`;
      }
    } catch {
      // invalid bech32 — leave as-is
    }
    return `@${bech32.slice(0, 8)}...`;
  });
}

/** Get a human-readable display name for a pubkey */
function getDisplayName(pubkey: string): string {
  const profile = profileCache.getCached(pubkey);
  return profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
}

function dispatchToast(
  type: NotificationType,
  title: string,
  event: NostrEvent,
  contextId?: string,
): void {
  const resolved = resolveNostrMentions(event.content);
  const preview =
    resolved.length > 80
      ? resolved.slice(0, 80) + "..."
      : resolved;

  const senderName = getDisplayName(event.pubkey);

  store.dispatch(
    addNotification({
      id: `${type}-${event.id}`,
      type,
      title: `${senderName}: ${title.toLowerCase()}`,
      body: preview,
      actorPubkey: event.pubkey,
      contextId,
      timestamp: Date.now(),
    }),
  );
}
