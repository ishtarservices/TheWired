# Friend System

## Overview

The Wired has a private friend request system built on top of Nostr's gift-wrap encryption (NIP-17). Unlike public follows (kind:3), friend requests are encrypted end-to-end — only the sender and recipient can see them.

**Friends = accepted friend request + mutual follow.** Both conditions must be true for someone to appear as a "Friend" in the app.

## Concepts

### Follow vs Friend

| | Follow | Friend |
|---|---|---|
| **Protocol** | Public kind:3 event | Private gift-wrapped DM (kind:1059) |
| **Visibility** | Anyone can see your follow list | Only sender and recipient know |
| **Direction** | One-way | Requires mutual acceptance |
| **Effect** | See their posts in feeds | Appear in DM friends list, "Friends" badge |

Following someone does NOT make them a friend. Friending someone auto-follows them.

### State Machine

```
[No relationship]
    │
    ├── Click "Follow" ──────────────► [Following] (one-way, public)
    │
    ├── Click "Add Friend" ──────────► [Pending Outgoing]
    │                                      │
    │                                      ├── Recipient accepts ──► [Friends]
    │                                      │                          (mutual follow + accepted request)
    │                                      │
    │                                      └── Click "Request Sent" ──► [No relationship]
    │                                           (cancel/unsend)
    │
    └── Receive friend request ──────► [Pending Incoming]
                                           │
                                           ├── Click "Accept" ──────► [Friends]
                                           │                          (auto-follows them)
                                           │
                                           └── Click "Decline" ─────► [No relationship]
                                                (local only, no event sent)

[Friends]
    │
    ├── Click "Friends" button ──────► [No relationship]
    │    (remove friend: clears request + auto-unfollows)
    │
    └── Click "Following" button ────► Confirmation dialog:
         (unfollow attempt)              "Unfollowing will also remove them as a friend."
                                         │
                                         ├── "Cancel" ──────► stays [Friends]
                                         └── "Unfollow & Unfriend" ──► [No relationship]
```

### Auto-Accept

If Alice sends Bob a friend request while Bob already has a pending request to Alice, Alice's request auto-accepts both directions. Both become friends immediately.

## Protocol

Friend requests reuse the existing NIP-17 gift-wrap DM infrastructure with a distinguishing tag on the rumor (the innermost decrypted layer).

### Event Structure

```
Gift Wrap (kind:1059)
  └── Seal (kind:13, encrypted)
       └── Rumor (kind:14, encrypted)
            ├── content: optional message (or "" for accepts)
            ├── tags: [["p", recipientPubkey], ["type", "friend_request"]]
            │                                   or ["type", "friend_request_accept"]
            └── pubkey: sender
```

### Event Types

| Tag | Meaning |
|-----|---------|
| `["type", "friend_request"]` | New friend request (content = optional message) |
| `["type", "friend_request_accept"]` | Acceptance of a friend request (content = "") |
| `["type", "friend_request_remove"]` | Friend removal notification (content = "") |

No event is sent for declining or canceling — those are local-only state changes.
Unfriending sends a remove wrap so the other user's client can clear the friendship.

### Self-Wraps

Every friend request sends two gift wraps: one to the recipient and one to the sender (self-wrap). This lets the sender see their own outgoing requests when the app reloads and fetches wraps from relays.

### Relay Compatibility

No relay changes needed. The relay is kind-agnostic and stores any valid Nostr event. Gift wraps (kind:1059) are already subscribed to during login.

## Client Architecture

### Redux State

**`store/slices/friendRequestSlice.ts`**

```typescript
interface FriendRequest {
  id: string;           // gift wrap event ID (dedup key)
  pubkey: string;       // the other user's pubkey
  message: string;      // optional message from sender
  createdAt: number;    // display timestamp
  status: "pending" | "accepted" | "declined";
  direction: "incoming" | "outgoing";
}

interface FriendRequestState {
  requests: FriendRequest[];
  processedWrapIds: string[];  // dedup relay echoes, capped at 3000
  removedPubkeys: string[];    // pubkeys explicitly unfriended/cancelled — blocks relay resurrection
}
```

**Reducers:**

| Reducer | Purpose |
|---------|---------|
| `addFriendRequest` | Add with wrap ID dedup + same-pubkey dedup (keep newer) |
| `acceptFriendRequest` | Mark incoming request as accepted |
| `declineFriendRequest` | Mark incoming request as declined |
| `markOutgoingAccepted` | Mark outgoing request as accepted (when recipient accepts) |
| `cancelFriendRequest` | Remove pending outgoing request + add to `removedPubkeys` |
| `removeFriend` | Remove all accepted requests for a pubkey + add to `removedPubkeys` |
| `clearRemovedPubkey` | Remove from `removedPubkeys` (when user re-sends a request) |
| `addProcessedWrapId` | Track a wrap ID as processed (used by accept wraps) |
| `restoreFriendRequestState` | Bulk restore from IndexedDB on startup (incl. `removedPubkeys`) |

### Service Layer

**`lib/nostr/friendRequest.ts`**

| Function | Description |
|----------|-------------|
| `sendFriendRequest(pubkey, message?)` | Creates + publishes gift wraps, handles auto-accept and dedup. Clears `removedPubkeys` for re-friending. |
| `acceptFriendRequestAction(pubkey)` | Sends accept gift wrap, updates state, auto-follows, syncs `knownFollowers`. Follow failure doesn't revert the accept. |
| `declineFriendRequestAction(pubkey)` | Local-only decline (no event sent) |
| `cancelFriendRequestAction(pubkey)` | Local-only cancel of outgoing request + adds to `removedPubkeys` |
| `removeFriendAction(pubkey)` | Unfollows first (with rollback on failure), then removes friendship state. Adds to `removedPubkeys`. |
| `wouldBreakFriendship(pubkey)` | Check if unfollowing would break a friendship (for confirmation dialog) |

### Persistence

**`lib/nostr/friendRequestPersistence.ts`**

Same pattern as DM persistence:
- `loadFriendRequestState()` — reads from IndexedDB `"friend_requests"` key, dispatches `restoreFriendRequestState`
- `startFriendRequestPersistence()` — subscribes to Redux store, debounced save every 5 seconds

Both are called during login in `loginFlow.ts` (after DM persistence setup).

### Event Pipeline Routing

**`lib/nostr/eventPipeline.ts`** — `handleGiftWrap()`

After decrypting a gift wrap, the pipeline checks for a `["type", ...]` tag before routing to DM handling:

```
unwrapGiftWrap(event)
  ├── type === "friend_request"        → handleFriendRequestWrap()
  ├── type === "friend_request_accept" → handleFriendAcceptWrap()
  ├── type === "friend_request_remove" → handleFriendRemoveWrap()
  └── no type tag                      → existing DM handling
```

`handleFriendRequestWrap` includes auto-accept logic: if we receive an incoming request and already have a pending outgoing to the same pubkey, both are auto-accepted and an accept wrap is sent back.

### Notification Evaluators

**`lib/nostr/notificationEvaluator.ts`**

| Function | Fires when |
|----------|------------|
| `evaluateFriendRequestNotification(pubkey, message)` | Incoming friend request (respects prefs/mutes/DND) |
| `evaluateFriendAcceptNotification(pubkey)` | Someone accepts our request |

Notifications use type `"friend_request"` and action type `"accept_friend"`.

### Friend Definition Hook

**`features/dm/useFriends.ts`**

Returns pubkeys that satisfy BOTH of:
1. You follow them (`followList`)
2. There is an accepted friend request (either direction) in `friendRequests`

Previously also required `knownFollowers` confirmation, but this was dropped because:
- `knownFollowers` depends on relay availability and is often incomplete at startup
- Accepting a friend request auto-follows in both directions
- The accept flow now explicitly syncs `knownFollowers` via `addKnownFollower`
- The profile page badge still uses `useMutualFollow()` for live per-user verification

This is the single source of truth for "who is a friend" in the DM sidebar.

## UI Components

### Profile Page (`features/profile/ProfilePage.tsx`)

- **Name badge**: Shows "Friends" (with HeartHandshake icon) when `friendStatus === "friends" && isMutual`. Shows "Following" otherwise.
- **Add Friend button**: Visible when `friendStatus === "none"`. Calls `sendFriendRequest()`.
- **Request Sent button**: Visible when `friendStatus === "pending_outgoing"`. Clickable to cancel. Turns red on hover.
- **Accept Request button**: Visible when `friendStatus === "pending_incoming"`. Calls `acceptFriendRequestAction()`.
- **Friends button**: Visible when `friendStatus === "friends"`. Clickable to remove friend. Turns red on hover.
- **Follow button**: Standard follow/unfollow. If unfollowing a friend, shows confirmation dialog: "Unfollowing will also remove them as a friend."

### User Popover Card (`features/profile/UserPopoverCard.tsx`)

Two-row action layout:
- **Row 1**: Profile, Message, Follow (core actions)
- **Row 2**: Full-width friend request button (Add Friend / Request Sent / Accept / Friends)

Same confirmation dialog for unfollowing friends. Same unified badge logic.

### Notification Bell (`features/notifications/NotificationBell.tsx`)

- `friend_request` type uses `HeartHandshake` icon with `text-pulse` color
- Shows "Accept" button for pending incoming friend requests
- Clicking Accept calls `acceptFriendRequestAction()` — the button disappears reactively when the request status changes

### Notification Toast (`features/notifications/NotificationToast.tsx`)

- Same icon/color as bell
- Actionable notifications (friend requests, follow-back) do NOT auto-dismiss after 6 seconds
- Toast hides itself locally (via `hiddenIds` state in the stack component) without removing from Redux — so the notification persists in the bell dropdown
- Clicking Accept performs the action and removes from everywhere
- Auto-hides after 18 seconds (3x normal) if not acted upon, but stays in bell

### DM Sidebar (`features/dm/DMSidebar.tsx`)

Friends tab shows:
1. **Pending Requests section** (if any): header with count badge, each item has avatar/name/message with Accept and Decline buttons
2. **Friends list**: people who satisfy the unified friend definition (accepted request + mutual follow)

### Navigation (`features/notifications/navigateToNotification.ts`)

`friend_request` notification type navigates to `/profile/{actorPubkey}`.

## Consistency Rules

1. **"Friends" badge only shows when both systems agree** — accepted friend request AND mutual follow (live relay check via `useMutualFollow`).
2. **Accepting a friend request auto-follows** — no separate follow needed. Also syncs `knownFollowers`.
3. **Unfollowing a friend requires confirmation** — dialog warns that unfollowing will also remove the friendship.
4. **Unfriending auto-unfollows** — clicking the "Friends" button unfollows first, then removes the friend request state. Adds pubkey to `removedPubkeys` to prevent relay resurrection.
5. **Declining/canceling is local-only** — no Nostr event is sent. Cancel adds to `removedPubkeys` so relay re-delivery doesn't resurrect the request.
6. **DM friends list** — shows people with accepted request + you follow them. Does NOT require `knownFollowers` confirmation (too unreliable across relays).
7. **Follow/unfollow has rollback** — if the kind:3 publish fails, Redux state reverts to the previous follow list.
8. **Re-friending clears removed state** — calling `sendFriendRequest` on a previously removed pubkey clears it from `removedPubkeys`.

## File Index

| File | Role |
|------|------|
| `store/slices/friendRequestSlice.ts` | Redux state and reducers |
| `lib/nostr/friendRequest.ts` | Service: send, accept, decline, cancel, remove, wouldBreak |
| `lib/nostr/friendRequestPersistence.ts` | IndexedDB load/save (debounced 5s) |
| `lib/nostr/eventPipeline.ts` | Routes gift wraps to friend request handlers |
| `lib/nostr/notificationEvaluator.ts` | Friend request notification evaluators |
| `lib/nostr/loginFlow.ts` | Loads friend request state + starts persistence |
| `lib/nostr/giftWrap.ts` | Gift wrap creation/unwrapping (shared with DMs) |
| `features/dm/useFriends.ts` | Unified friend definition hook |
| `features/profile/ProfilePage.tsx` | Friend buttons + badge + unfollow confirmation |
| `features/profile/UserPopoverCard.tsx` | Friend buttons + badge + unfollow confirmation |
| `features/dm/DMSidebar.tsx` | Pending requests section + friends list |
| `features/notifications/NotificationBell.tsx` | Friend request notifications + Accept button |
| `features/notifications/NotificationToast.tsx` | Persistent actionable toasts |
| `features/notifications/navigateToNotification.ts` | friend_request → profile navigation |
| `store/slices/notificationSlice.ts` | `friend_request` type + `accept_friend` action type |
| `store/index.ts` | `friendRequests` reducer registered |
