# NIP-17 Group Rooms — E2EE group chat (Decentralized Spaces M8)

> Status: **engine shipped + tested; feature integration deferred (this is the TODO).**
> Companion to `PACKAGES_DESIGN.md` §6/§7 and the decentralized-spaces plan (M0–M9).

## What this is — and why it's separate from spaces

NIP-29 spaces (M1–M9) are **access control, not encryption**: the relay reads every
message in plaintext, which is what enables moderation (kick/ban/delete) and
server-side search/analytics/push. "Private" there = members-only *read*, not
encrypted.

M8 is the **end-to-end-encrypted** track — the one place message content is actually
hidden from the relay. It coexists with NIP-29 spaces as a separate tier; it is **not**
a migration. The trade is explicit: privacy **instead of** moderation + discovery.

Two layers:
- **NIP-17 gift-wrapped rooms** — shippable now, built on the existing 1:1 DM stack.
  O(N) wraps/message, no moderation → best for **small private rooms**.
- **MLS over Nostr** (NIP-EE / "Marmot" / `nostr-mls`) — scalable, forward-secret
  groups. **Alpha / pre-audit → tracked, not built.**

## "Model B" boundary (the research deliverable)

E2EE only coheres when **no backend reads plaintext**. So for an encrypted room,
search, analytics, push, and directory discovery are **necessarily off** — they read
content that no longer exists in the clear. An encrypted room is therefore a distinct
tier, not a flag on a normal space.

## What's DONE — the protocol engine

`client/src/lib/nostr/nip17Room.ts` (+ `__tests__/nip17Room.test.ts`, 7 tests):

- `createGroupMessageWraps(content, participants, myPubkey, opts)` — builds ONE kind:14
  rumor `p`-tagging every recipient, then gift-wraps it **once per participant + a
  self-wrap** (each an independent NIP-44 encryption). Reuses the tested
  `giftWrap.ts` primitives (`buildRumor` / `createGiftWrappedDM` / `createSelfWrap`).
- `roomKeyFromParticipants` (sorted-deduped membership key), `participantsOf`,
  `isGroupDM` (≥3 distinct participants), `roomIdOf` (explicit `g` tag else derived),
  `subjectOf`.

**The relay needs ZERO changes:** kind:1059 routes by its `p` tag via the M0 `p_tags`
column, and gift wraps already bypass NIP-29 membership gating (1059 isn't an h-tagged
gated kind). Verified against the current handler.

## What's LEFT — the feature integration (the actual TODO)

The DM store + UI are fundamentally 1:1-shaped, so the work is generalizing them. Do
the store change first and gate/test the receive-path change before it goes live —
this is the live, E2EE DM path; a mis-route or a wrong-key decryption slipping through
is the failure mode to guard against.

1. **Store** — generalize `store/slices/dmSlice.ts` from single-`partnerPubkey` keying
   to a `conversationId` key (roomId for groups, pubkey for 1:1) + per-conversation
   metadata (`isRoom`, `participants`, `subject`). `DMContact` gains optional room
   fields (a room's "pubkey" is the synthetic roomId, so avatar/name lookups must
   branch).
2. **Receive** — in `lib/nostr/eventPipeline.ts` (~line 932, the unwrapped-DM routing),
   after the `type`-tag checks, branch on `isGroupDM(dm)`: route under
   `roomIdOf(dm)` instead of the single-partner logic, and **bypass the `HEX64_RE`
   guard** for room ids (a roomId isn't 64-hex). Mark/create the room contact with
   `subjectOf`/`participantsOf`.
3. **Send** — `sendGroupRoomMessage(participants, content, opts)` in `dmService.ts`:
   `createGroupMessageWraps` → publish each wrap to **that recipient's** DM inbox
   relays (`getDMRelaysForPublish`) + self-wrap to own DM relays → optimistic
   `addDMMessage` under the roomId. Edit/delete follow the existing `dm_edit`/
   `dm_delete` type-tag pattern, keyed by roomId.
4. **UI** — multi-recipient create-room flow (extend `NewDMModal`), room entries in
   `DMSidebar` (group icon + subject + participant avatars), group rendering in
   `DMConversation` with per-message sender labels, and `DMInput` calling
   `sendGroupRoomMessage` when the active conversation is a room.

## Design decisions baked in

- **Room identity:** explicit stable `g`-tag roomId for named/persistent rooms;
  membership-derived `roomKeyFromParticipants` for ad-hoc rooms (every member computes
  the same key).
- **No new relay kinds / no relay changes** — reuse kind:1059 transport.
- **Coexists with NIP-29 spaces** — a community can have both a moderated space and an
  encrypted side-room; this is a per-conversation tier, not a space mode.
- **MLS stays behind an audit gate** — don't ship `nostr-mls` until it's reviewed.

## Trade-offs / non-goals

- O(N) gift wraps per message → small rooms only (not large communities).
- No moderation/admin visibility (that's the point of E2EE).
- No server-side search / unread-by-relay / push for room content (Model B boundary).

## References

NIP-17 <https://nips.nostr.com/17> · NIP-44 <https://nips.nostr.com/44> · NIP-59
<https://nips.nostr.com/59> · NIP-EE <https://nips.nostr.com/EE> · nostr-mls
<https://docs.rs/nostr-mls/>
