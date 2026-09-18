# Reactions, un-react and DM reactions — web ↔ mobile wire contract

The desktop/web client and the mobile app share one wire format for reactions
so a reaction set on either surface renders on the other. The contract below is
fixed; do not invent different tags or kinds. Mobile implements the same
read-side leniencies (rumorId-first-then-wrapId, `"" → "+"`, unknown typed
rumors dropped), so either client can ship ahead of the other.

| Feature | Event | Shape |
|---|---|---|
| Reaction | kind 7 | `["e", targetId]`, `["p", targetAuthor]`, `["k", String(target.kind)]`; content = emoji, `""` normalized to `"+"`; optional `["emoji", shortcode, url]` (NIP-30). Target is a chat message (kind 9): additionally `["h", spaceId]`, published to the space's relay set (host + mirrors). |
| Un-react | kind 5 | `["e", reactionEventId]`, `["k", "7"]`; content `""`. Chat reactions: additionally `["h", spaceId]` so `#h` subscribers receive it. **Never** e-tag the target message — only the reaction event id. |
| Chat reply | kind 9 | `["q", targetEventId]` + `["p", targetPubkey]` (`buildChatMessage`, unchanged). |
| DM reaction | NIP-17 typed rumor | rumor kind 14, tags `["type", "dm_reaction"]`, `["e", <rumorId of target>]`; content = unicode emoji. Removal: `["type", "dm_reaction_remove"]`, same `e` tag, content = the emoji removed. Dual-wrapped like `dm_edit` (recipient wrap + self wrap sharing one rumor). Anchor is the **rumor id**, never a wrap id. Plain unicode only. |
| DM reply | rumor `q` tag | Write `["q", <target's rumorId>]`. Read: resolve rumorId-first, wrapId-fallback (older clients quoted wrap ids, which differ per holder). |

## Where it lives (client/)

- **Builders** — `lib/nostr/eventBuilder.ts`: `buildReaction(…, spaceId?)`,
  `buildReactionDeletion(pubkey, reactionEventId, spaceId?)`.
- **Single publish path** — `features/reactions/reactionToggle.ts`:
  `toggleReaction` (same emoji = un-react, different emoji adds — chat allows
  several per user), `toggleLike` (notes: any own reaction = liked; unlike
  retracts every own reaction, one kind 5 each), relay targeting
  (`reactionRelayTargets`) and the `h` rule (`reactionSpaceId`). Optimistic
  removal with rollback on publish failure. Used by `ReactionPicker`,
  `ChatMessage` pills, `useNoteActions`, `useProfileNoteActions`.
- **Subscriptions** — kind 7 is part of the chat routes (`channelRoutes.ts`,
  `spaceChannelRoutes.ts`) and the background host sub (`groupSubscriptions.ts`).
  `splitChatFilters` (`filterBuilder.ts`) keeps reactions in their own filter so
  they don't consume the 50-message page. Note engagement subs
  (`useNoteEngagementSub.ts`, `engagementCollector.tsx`) carry a kind-5 leg whose
  `#e` unions note ids with already-known reaction ids (a kind 5 references the
  reaction, not the note; coverage converges as the sub re-fires).
- **Pipeline** — kind 7 folds into `reactionsSlice` (shape-based, `h` ignored);
  kind 5 → `removeReactionByEventId` (reactor-gated); a kind 5 that arrives
  *before* its kind 7 pre-suppresses it (step 3d). Typed rumors `dm_reaction` /
  `dm_reaction_remove` → `handleDMReactionWrap` → `dmSlice.reactDMMessage` /
  `removeDMReaction`. Unknown `type` rumors are dropped.
- **DM state** — `DMMessage.reactions?: Record<emoji, reactorPubkey[]>`, max 16
  distinct emoji; wrap-id dedup (self-wrap echo applies once); reactions that
  arrive before their target are buffered in `pendingReactions` and drained by
  `addDMMessage`. `replyToWrapId` keeps its name for persistence but holds "the
  q value"; `resolveDMReplyTarget` (`dmUtils.ts`) does rumorId → wrapId
  resolution and the jump uses the resolved message's wrapId.
- **UI** — `components/chat/ReactionPills.tsx` (shared by chat + DMs, own pills
  highlighted, tap toggles); `ReactionPicker` has a select-only, unicode-only
  mode for DMs; DM bubbles get a hover React button and a context-menu entry,
  hidden for legacy rows without a `rumorId`.

## Backend

No changes. h-tagged kind 7s are classified `reaction` by
`ingestHandlers.decideAction` and only bump `member_engagement` counters; the
push path (`enqueueNotification`) is never called for reactions, so nothing
renders as "reacted to your note" and no notification preference is involved.
Mobile consumes `GET /gif/trending|search` and `POST /gif/register-share` as-is.
