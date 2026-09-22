NIP-XX
======

Private Friend Requests
-----------------------

`draft` `optional`

This NIP defines a protocol for explicit, private friend requests between Nostr users. It layers on top of [NIP-17](17.md) (private direct messages) and [NIP-59](59.md) (gift wrap) using a `type` tag convention on kind `14` rumors -- no new event kinds are required.

## Motivation

The current Nostr convention for expressing social connections is the follow list (kind `3`, [NIP-02](02.md)). Following is unilateral: Alice can follow Bob without Bob's consent or awareness (beyond noticing a new follower). There is no standard mechanism for:

- **Requesting** a bidirectional connection that the other party must accept.
- **Declining** a connection request privately.
- **Dissolving** an established connection with notification.
- Performing any of the above **without revealing the social graph** to relays or third-party observers.

Applications building chat-centric, community, or gaming experiences often need an explicit friendship model (similar to Discord, Telegram, or Signal) rather than the follow/follower model of microblogging clients. This NIP provides that without conflicting with or replacing NIP-02 follows.

## Overview

Friend requests are transmitted as [NIP-17](17.md) private direct messages. The inner kind `14` rumor carries a `type` tag that distinguishes friend request operations from normal DM messages. Because the entire payload is gift-wrapped ([NIP-59](59.md)), neither the relay nor any observer can distinguish a friend request from a regular DM.

Three operations are defined:

| Type Tag Value | Operation | Description |
| --- | --- | --- |
| `friend_request` | Request | Sender asks recipient to become friends. |
| `friend_request_accept` | Accept | Recipient accepts a pending request. |
| `friend_request_remove` | Remove | Either party dissolves the friendship. |

## Protocol Flow

### Sending a Friend Request

1. Construct a kind `14` rumor (unsigned event) with:
   - `content`: An optional message to the recipient (e.g. "Hey, we met at the conference").
   - Tags:
     - `["p", "<recipient-pubkey>"]` -- the recipient.
     - `["type", "friend_request"]` -- identifies this as a friend request.
2. Wrap the rumor in a kind `13` seal and kind `1059` gift wrap per [NIP-17](17.md), addressed to the **recipient**.
3. Create a second gift wrap of the same rumor addressed to **yourself** (self-wrap). This allows the sender to reconstruct their outgoing request history across sessions and devices.
4. Publish both gift wraps to the recipient's preferred DM relays (kind `10050` per [NIP-17](17.md)). If the recipient has no kind `10050` event, fall back to the sender's own DM relays, then to general-purpose relays.

```jsonc
// Inner rumor (kind 14, never published directly)
{
  "kind": 14,
  "pubkey": "<sender-pubkey>",
  "content": "Hey, we met at the conference!",
  "tags": [
    ["p", "<recipient-pubkey>"],
    ["type", "friend_request"]
  ],
  "created_at": 1708000000
  // no id, no sig (rumor)
}
```

### Accepting a Friend Request

1. Construct a kind `14` rumor with:
   - `content`: Empty string (or an optional acceptance message).
   - Tags:
     - `["p", "<original-sender-pubkey>"]` -- the person who sent the request.
     - `["type", "friend_request_accept"]`
2. Wrap and publish per the same procedure (recipient wrap + self-wrap).
3. Upon sending the acceptance, the client SHOULD update the user's kind `3` follow list to include the new friend's pubkey, if not already present.

```jsonc
// Inner rumor (kind 14)
{
  "kind": 14,
  "pubkey": "<recipient-pubkey>",
  "content": "",
  "tags": [
    ["p", "<original-sender-pubkey>"],
    ["type", "friend_request_accept"]
  ],
  "created_at": 1708000100
}
```

### Removing a Friend

1. Construct a kind `14` rumor with:
   - `content`: Empty string.
   - Tags:
     - `["p", "<other-pubkey>"]` -- the friend being removed.
     - `["type", "friend_request_remove"]`
2. Wrap and publish per the same procedure.
3. The client SHOULD update the user's kind `3` follow list to remove the other party's pubkey.

```jsonc
// Inner rumor (kind 14)
{
  "kind": 14,
  "pubkey": "<remover-pubkey>",
  "content": "",
  "tags": [
    ["p", "<other-pubkey>"],
    ["type", "friend_request_remove"]
  ],
  "created_at": 1708100000
}
```

## Client Behavior

### State Machine

From a given user's perspective, the friendship state with another user follows this state machine:

```
                     send request
           none ──────────────────────> pending_outgoing
            ^                                  |
            |  receive remove                  |  receive accept
            |                                  v
            +──────────────────────── friends
            |                                  ^
            |  decline (local)                 |  send accept
            |                                  |
           pending_incoming <──────────────────+
                     receive request
```

### Auto-Accept (Mutual Requests)

If Alice sends a friend request to Bob, and Bob independently sends a friend request to Alice before receiving hers, both clients SHOULD detect the mutual pending state and automatically transition to `friends` without requiring manual acceptance. This provides a seamless experience when two users request each other simultaneously.

Specifically: when processing an incoming `friend_request`, if a `pending_outgoing` request to the same pubkey already exists locally, the client SHOULD immediately:
1. Transition the state to `friends` (both the outgoing and the new incoming row become accepted).
2. Publish a `friend_request_accept` to notify the other party.
3. Update the kind `3` follow list.

The same applies when the local user *sends* a request while an incoming one from that pubkey is pending: the client SHOULD send `friend_request_accept` instead of a second `friend_request`. Both paths are required; a client implementing only the send-side rule leaves the peer stuck in `pending_outgoing` when requests cross in flight.

### Decline

Declining a friend request is a **local-only** operation. The client simply discards the pending request from its state. No event is published to the sender. This preserves privacy -- the sender cannot distinguish between "declined" and "not yet seen."

### Self-Wraps and Persistence

Because gift wraps use ephemeral keypairs, the sender cannot decrypt their own outgoing wraps from relays. The self-wrap (a second gift wrap addressed to the sender's own pubkey) solves this by allowing the sender to:
- Reconstruct outgoing request history on new devices.
- Detect mutual pending requests for auto-accept.
- Display sent requests in the UI.

Clients MUST publish a self-wrap for every friend request operation. Both wraps MUST carry the **same rumor** (same rumor id and `created_at`). Clients SHOULD persist processed wrap IDs locally to avoid re-processing the same event.

### Applying Self-Wrap Echoes (Multi-Device Sync)

Friendship state is local to each device; nothing beyond the wraps themselves is stored on relays. A client therefore MUST apply its **own** self-wrap echoes (rumor `pubkey` equals the local user, partner = the non-self `p` tag) exactly as it would apply the operation performed locally:

| Own echo | Effect |
| --- | --- |
| `friend_request` | Create (or keep) the *outgoing pending* row for the partner. |
| `friend_request_accept` | Mark the *incoming* row for the partner accepted (create it accepted if absent). |
| `friend_request_remove` | Clear the partner's rows and record the removal (see below). |

Without this, an accept or removal performed on one device never reaches the user's other devices, because the peer's side of the exchange alone does not resolve the local row.

### Ordering and Replay

Relays replay every wrap on reconnect, typically newest first, and a new device receives the full history at once. Clients MUST order operations by the **rumor's `created_at`** (the wrap's own timestamp is randomised per NIP-59), never by receive time. Rows SHOULD be stamped with the rumor `created_at` of the wrap that produced them. The following rules keep replays from resurrecting dissolved or already-resolved state:

- **Removal marker.** On `friend_request_remove` (own or peer's), record `removedAt[partner] = rumor.created_at`. Only rows with `created_at <= removedAt` are cleared; newer rows belong to a later cycle and survive.
- **Stale replay.** A `friend_request` or `friend_request_accept` whose `created_at <= removedAt[partner]` is a replay from before the removal: record its wrap id and drop it. One that is newer starts a new cycle and clears the marker.
- **Accept before request.** An accept may arrive before the request it resolves. The client MUST create the row already accepted; an older request arriving later MUST NOT reopen it (a pending request never replaces a resolved row with a later `created_at`).
- **Sibling rows.** When any row for a partner becomes accepted, any pending row for the same partner in the other direction is resolved too, so the UI never shows a stale "accept" card once the pair are friends.

### Deduplication

Clients SHOULD prevent duplicate requests:
- If a `pending_outgoing` request to a pubkey already exists, or the pair are already `friends`, do not send another `friend_request`.
- If a `friends` state already exists with a pubkey and an incoming `friend_request` arrives that is **older** than the row that established the friendship, ignore it (replay). If it is **newer** (the peer re-requested, e.g. after a removal this client never saw), treat it like a mutual request: mark it accepted and reply with `friend_request_accept` so the peer converges.

### Relay Selection

Friend request wraps SHOULD be published to the recipient's DM relay list (kind `10050` per [NIP-17](17.md)). The relay selection follows the same conventions as NIP-17 direct messages:

1. Read the recipient's kind `10050` event for their preferred DM relays.
2. If no kind `10050` event is found, use the sender's own DM relays.
3. If neither is available, fall back to general-purpose relays.

## Relationship to NIP-02 (Follow Lists)

This NIP is **complementary** to NIP-02, not a replacement:

- **NIP-02 follows** are unilateral, public, and work well for microblogging (follow someone to see their posts).
- **NIP-XX friend requests** are bilateral, private, and work well for chat and community apps (explicit consent before interaction).

Clients that implement this NIP SHOULD treat friendship acceptance as a trigger to update the kind `3` follow list (add on accept, remove on unfriend). This ensures that NIP-02-aware clients automatically see friends in their follow graph, even if they don't implement this NIP.

Clients that do not implement this NIP are unaffected. Friend request gift wraps appear as normal NIP-17 DMs that they can safely ignore (the `type` tag is simply unrecognized).

## Privacy Considerations

- **Relay blindness**: Relays see only kind `1059` gift wraps. They cannot distinguish friend requests from regular DMs.
- **Observer blindness**: Third parties cannot determine who has sent friend requests to whom. The social graph remains private.
- **Decline privacy**: Declining is local-only. The sender receives no signal, preventing social pressure or harassment based on rejected requests.
- **Metadata leakage**: The timing and relay destination of gift wraps may leak some metadata (as with all NIP-17 messages). Clients concerned about this MAY add random delays before publishing.

## Interaction with Other NIPs

| NIP | Integration |
| --- | --- |
| [NIP-02](02.md) | Acceptance triggers kind `3` follow list update. Removal triggers kind `3` unfollow. |
| [NIP-17](17.md) | Friend requests use the same gift wrap transport as private DMs. |
| [NIP-44](44.md) | Encryption of the seal layer. |
| [NIP-59](59.md) | Gift wrap envelope and ephemeral keypair signing. |
