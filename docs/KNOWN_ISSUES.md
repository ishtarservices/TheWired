# Known Issues & Deferred Fixes

Tracked, intentionally-deferred work and rough edges. Each entry says **why** it
was deferred and **where** the fix would land, so it can be picked up cleanly.

Most entries below came out of the client **event-storm optimization** work
(profile/spaces floods + UI freeze). The shipped parts of that work are
summarized in the agent memory (`project_perf_optimizations.md`); what remains
is here.

---

## Deferred — Client performance

### 1. List virtualization (Phase 5b)

**Why deferred:** Adding `react-virtuoso` to the feeds is a *scroll/UX* change —
variable item heights, chat reverse-scroll, scroll restoration, and replacing the
`LoadMoreSentinel` IntersectionObserver with `endReached`/`startReached`. Its
correctness can't be validated by unit tests, and a regression would hurt the
core experience more than the original perf issue. With dispatch batching (P1),
reactions out of the entity store (P3), and stable list selectors (P5a), the
re-render storms it targeted are already gone — so it's now polish, best done
with the app running + manual QA.

**Where:** `NotesFeed.tsx`, `MediaFeed.tsx`, the space chat message list, and the
profile `FeedTab` (`ProfilePage.tsx`). When done, drive the engagement collector
from Virtuoso's `rangeChanged` instead of the per-card observer.

### 2. Unmemoized `articles` selector → re-render warning

**Why:** React-Redux logs *"Selector unknown returned a different result when
called with the same parameters"*. The `articles` view in `useProfileFeed`
returns `result.map(parseLongFormEvent)`, minting new objects every call, so the
`shallowEqual` equality check can never stabilize it → unnecessary re-renders
(dev-only warning, but real churn).

**Where:** `client/src/features/profile/useProfileNotes.ts` — memoize the parsed
article objects (e.g. cache `parseLongFormEvent` by event id, or select raw
events and parse in a `useMemo`).

### 3. Account-switch cold-start freeze (~2s)

**Why:** A ~1900ms main-thread freeze occurs during `switchAccount` →
`performCleanup` → `relayManager.disconnectAll()` followed by the reconnect storm
(all relays redial at once). This is a one-time cold-start path, distinct from the
profile-navigation freeze that the optimization work fixed.

**Where:** `loginFlow.ts` (`switchAccount`/`performCleanup`) +
`relayManager.ts`/`relayConnection.ts` reconnect scheduling. Likely wants
staggered redials and/or deferring heavy first-render work off the switch.

### 4. Relay connection noise from outbox fan-out

**Why:** Outbox routing (Phase 6) dials each viewed author's NIP-65 write relays,
so a profile can now target 7–21 relays; unreachable ones spam
`WebSocket … network connection lost`. Cosmetic (dead relays are skipped) but
noisy, and it raises connection churn. Includes the long-standing
`relay.nostr.band`/`relay.thewired.app` reconnect retries.

**Where:** `relayConnection.ts` reconnect logic — add an **N-strike backoff** so a
relay that fails to connect N times is dropped (or backed off hard) for the
session instead of retried every few seconds.

### 5. "Load more" on accounts with many joined spaces

**Why:** Intermittent failures clicking "load more" on a heavily-joined account.
Low priority / edge case per product owner.

**Where:** space feed pagination (`groupSubscriptions.ts` `loadMoreSpaceFeed`) +
the relay subscription cap (`relayConnection.ts` `DEFAULT_MAX_SUBS`); the trace
shows per-relay sub caps (20/10) being hit during heavy fan-out, which can defer
the pagination REQ.

---

## Deferred — Architecture

### 6. Nostrify-style transport refactor (separate thread)

Adopting `req()`/`AbortSignal` + an `NStore`-shaped interface over
`relayConnection`/`relayManager`/`subscriptionManager`. **Does not fix
performance and is not a federation prerequisite** — it's an ergonomics/
maintainability investment. See the section below for what it must preserve.

---

## Planned Nostrify refactor — contracts the optimization work added

If/when the transport layer is refactored, these seams from the perf work are
**load-bearing** and must be preserved (or re-homed):

1. **The `relayUrl` source distinction into `processIncomingEvent` is the
   batching seam.** `eventPipeline.isBurstSource()` batches only `ws(s)://`
   sources; synthetic sources (`"local"` optimistic sends, `"resolve"`/`"search"`/
   `"browse"`/`"embedded"`) stay immediate so awaiting callers read fresh state.
   Whatever replaces `subscriptionManager.onEvent` **must keep passing a real
   relay URL for live subs and the synthetic strings for optimistic/resolver
   paths.** If events arrive without that tag, optimistic sends get a 50ms delay
   and resolvers read stale Redux.

2. **Keep feeding the batching buffer, not per-event dispatch.** The buffer +
   coalesced flush live in `eventPipeline` (downstream of transport). A
   `for await (const msg of pool.req(...))` loop should still call
   `processIncomingEvent(event, relayUrl)` per event — do **not** reintroduce
   per-event `store.dispatch`.

3. **`relayManager.onReconnect()` is now used** by the background-chat-sub rebuild
   (`groupSubscriptions.ts`) to refresh `since` on reconnect. A `req()` model
   handles reconnect internally — re-expose an equivalent reconnect signal, or
   move the fresh-`since` rebuild into the new resubscribe path.

4. **`subscriptionManager.getReconnectSince(subId)` is now wired** (was dead
   code) — the bg-sub rebuild uses it so a reconnect doesn't replay the whole
   backlog. The new model needs a per-subscription "latest event seen" to carry a
   fresh `since` on resubscribe.

5. **`relayManager.subscribe` auto-dials unconnected target relays read-only.**
   Outbox (`useAuthorWriteRelays`) relies on this: passing an author's write-relay
   URLs auto-connects them. An `NPool`-style model needs the same lazy `open(url)`.

6. **These are the call sites the refactor touches** — all go through
   `subscriptionManager.subscribe/close` + `relayManager.onReconnect/
   closeSubscription`, and map cleanly to `req()` + `AbortSignal` (abort = close):
   - `engagementCollector.ts` (`EngagementWindow` — open/close per scroll chunk; the poster child for AbortSignal)
   - `groupSubscriptions.ts` (host-relay bg chat subs, per-channel subs, pagination)
   - `useProfileNotes.ts` `useAuthorWriteRelays` (one-shot NIP-65 lookup)
   - `profileCache.ts` `relayFetch` (batched kind:0)

7. **Coalescing opportunity the refactor unlocks:** the per-host background chat
   sub (multi-`#h`) and the active-channel chat sub overlap (both query
   `kinds:[9,5,9005]` + `#h` for the active space). Dedup catches the
   double-delivery today, but a coalescing layer (which `NStore`/`req()` enables)
   could merge them.

8. **Reactions are no longer stored as full events** — they live in
   `reactionsSlice` (`byTarget`/`byEventId`). If the refactor touches the kind:7
   path, keep routing to `addReaction`, not `addEvent`.

9. **Test mocks to update:** 4 test files mock `relayManager` and/or
   `subscriptionManager` (`zap`, `profileCache`, `groupSubscriptions`,
   `subscriptionManager`). Changing these singletons' shapes requires updating the
   mocks — a partial mock that omits a now-required method (e.g. `onReconnect`)
   throws *"X is not a function"* at module load via the transitive import chain.
