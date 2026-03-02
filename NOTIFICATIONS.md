# Notification System

Full-stack notification system spanning client Redux state, in-app toasts, unread badges, notification preferences, per-space muting, browser notifications, and backend push delivery.

---

## Architecture Overview

```
Incoming Event
  └─ eventPipeline.ts
       ├─ indexEvent()          ← existing kind routing
       └─ evaluateNotification()← NEW: checks prefs/mutes/DND, dispatches Redux actions
            ├─ incrementUnread / incrementMention   → sidebar badges
            ├─ addNotification                      → toast stack + bell dropdown
            └─ evaluateDMNotification               → DM-specific path (from handleGiftWrap)

Backend (relayIngester)
  └─ indexChatMessage()
       └─ enqueueNotification() ← NEW: inserts into notification_queue for push delivery
            └─ notificationDispatcher worker polls queue → web-push → OS notification
```

---

## New Files

| File | Purpose |
|------|---------|
| `client/src/store/slices/notificationSlice.ts` | Redux slice: unread counts, mentions, mutes, preferences, in-app notifications with read/unread state |
| `client/src/features/notifications/useNotifications.ts` | Selector hooks: `useSpaceUnread`, `useChannelUnread`, `useSpaceMentions`, `useChannelMentions`, `useSpaceMuted`, `useTotalUnread`, `useNotificationPreferences`, `useUnreadNotificationCount` |
| `client/src/lib/nostr/notificationEvaluator.ts` | Evaluates incoming events against preferences/mutes/DND, dispatches unread increments and toast notifications |
| `client/src/features/notifications/notificationPersistence.ts` | Persists unread state to IndexedDB (debounced 5s), preferences to localStorage |
| `client/src/features/notifications/NotificationToast.tsx` | Fixed bottom-right toast stack (max 5, auto-dismiss 6s, card-glass styling) |
| `client/src/features/notifications/NotificationBell.tsx` | TopBar bell icon with unread badge + dropdown panel listing all notifications with read/unread state |
| `client/src/features/notifications/browserNotify.ts` | `requestBrowserPermission()` + `showBrowserNotification()` (fires only when app unfocused) |
| `client/src/features/notifications/registerServiceWorker.ts` | Registers `sw.js`, subscribes PushManager with VAPID key, sends subscription to backend |
| `client/src/features/settings/NotificationSettingsTab.tsx` | Settings UI: toggles for mentions/DMs/followers/chat/browser/sound + DND with duration picker |
| `client/src/features/spaces/SpaceContextMenu.tsx` | Right-click context menu on spaces: mute notifications with duration options (1h/8h/24h/permanent) |
| `client/public/sw.js` | Service Worker: handles `push` events (show OS notification) and `notificationclick` (focus app) |
| `client/src/lib/api/notifications.ts` | Client API wrappers: `getNotificationPreferences()`, `updateNotificationPreferences()` |
| `services/backend/src/services/notificationEnqueue.ts` | `enqueueNotification()` — inserts into `notification_queue` after checking server-side preferences |
| `services/backend/src/routes/notifications.ts` | `GET/PUT /notifications/preferences` endpoints |
| `services/backend/src/db/migrations/0004_notification_prefs.sql` | Migration: `app.notification_preferences` table |

## Modified Files

| File | Change |
|------|--------|
| `client/src/store/index.ts` | Registered `notificationSlice` |
| `client/src/lib/nostr/eventPipeline.ts` | Calls `evaluateNotification()` after `indexEvent()`; calls `evaluateDMNotification()` in `handleGiftWrap()` for incoming DMs only |
| `client/src/features/spaces/SpaceList.tsx` | Unread/mention badges on space buttons, muted bell-off icon, right-click context menu |
| `client/src/features/spaces/ChannelList.tsx` | Per-channel unread/mention badges via `ChannelButton` sub-component |
| `client/src/features/spaces/useSpace.ts` | Dispatches `clearChannelUnread` + `updateLastRead` on channel selection |
| `client/src/app/Layout.tsx` | Mounts `<NotificationToastStack />` |
| `client/src/index.css` | Added `animate-slide-up` keyframe |
| `client/src/components/layout/TopBar.tsx` | Added `<NotificationBell />` between search and theme toggle |
| `client/src/features/settings/SettingsPage.tsx` | Added "Notifications" tab |
| `services/backend/src/server.ts` | Registered `/notifications` routes |
| `services/backend/src/workers/relayIngester.ts` | Enqueues push notifications for mentioned pubkeys in chat messages |
| `services/backend/src/db/schema/notifications.ts` | Added `notificationPreferences` Drizzle table schema |

---

## Redux State Shape

```ts
notifications: {
  spaceUnread:        Record<spaceId, number>
  channelUnread:      Record<"spaceId:channelId", number>
  spaceMentions:      Record<spaceId, number>
  channelMentions:    Record<"spaceId:channelId", number>
  notifications:      InAppNotification[]   // { id, type, title, body, actorPubkey?, contextId?, timestamp, read? }
  spaceMutes:         Record<spaceId, { muted: boolean, muteUntil?: number }>
  preferences:        NotificationPreferences
  lastReadTimestamps: Record<contextId, unixSeconds>
}
```

## Notification Evaluation Flow

1. Event arrives via `processIncomingEvent()` → dedup → validate → verify → index
2. `evaluateNotification(event)` runs post-index:
   - Skip if: own event, global DND active, user-level mute list match, master toggle off
   - **Kind 9 (chat)**: check space mute → resolve channel → if not currently viewing: `incrementUnread`; if p-tag matches self: `incrementMention` + toast
   - **Kind 3 (follow list)**: if our pubkey in p-tags: toast notification
3. `evaluateDMNotification()` runs from `handleGiftWrap()` for incoming DMs only (not own messages)
4. Toasts auto-dismiss after 6s; also trigger `showBrowserNotification()` if permission granted and app unfocused

## Unread Badge Clearing

- `useSpace.selectChannel()` dispatches `clearChannelUnread(channelId)` + `updateLastRead()`
- `clearChannelUnread` subtracts channel counts from parent space totals and deletes the channel entries
- Persistence: debounced 5s write to IndexedDB via `scheduleSaveNotificationState()`

## Bell Dropdown Behavior

- Unread count badge on bell icon (pulse-colored, matches DM badge pattern)
- Click opens a max-420px scrollable dropdown with newest-first ordering
- Each row: unread dot, type icon, title, body (2-line clamp), relative time
- Click a notification → marks it read (count decrements)
- Header actions: "Mark all read" (CheckCheck icon), "Clear all" (Trash icon)
- Closes on click outside or Escape

## Settings

**Notification toggles** (stored client-side in localStorage, synced to backend):
- Master enable, Mentions, DMs, New followers, Chat messages, Browser notifications, Sound

**Do Not Disturb**: toggle + duration picker (1h / 4h / 8h / permanent)

**Per-space mute**: right-click any space → Mute notifications → 1h / 8h / 24h / permanent

## Backend Push Pipeline

1. `relayIngester` extracts p-tags from chat messages → calls `enqueueNotification()` per mentioned pubkey
2. `enqueueNotification()` checks `notification_preferences` table → inserts into `notification_queue`
3. `notificationDispatcher` worker polls queue every 30s → sends via `web-push` VAPID → marks sent
4. Client service worker (`sw.js`) receives push → shows OS notification → click focuses app

## Gateway

No gateway changes required — the Go gateway generically proxies all `/api/*` routes to the backend. The new `/api/notifications/preferences` endpoint works automatically with existing NIP-98 auth and rate limiting.
