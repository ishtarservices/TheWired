# NIP-29 Chat — Bugs Fixed and Remaining Work

This doc tracks the multi-layered NIP-29 chat read-path investigation. It serves as both a record of what's been fixed and a roadmap for what's still outstanding.

The original symptom: **users (especially "9-Alpha", who had 27 cached spaces) reported that messages in spaces don't reliably send/receive**. Restarting the app sometimes briefly worked. "Switch spaces and back" sometimes recovered. Per-account variance was extreme: same machine, same build, same network — purely account-dependent.

The investigation found **at least eight distinct issues** across client and relay. Five were fixed early. Phase 1 (this doc's primary cap fix) covers the dominant cause for power users. Phases 2-3 are not yet shipped.

---

## Already shipped (early fixes)

These five were addressed before Phase 1 cap work. They are documented here for reference; the fixes themselves live in the commit history.

| # | Symptom | Fix |
|---|---|---|
| 1 | Client published kind:9 to NIP-65 outbox relays instead of the space's host relay | `useChat.ts` `sendMessage` / `deleteMessageForEveryone` / `modDeleteMessage` / `editMessage` now read `space.hostRelay` from Redux and pass `[hostRelay]` as the publish target |
| 2 | NIP-42 AUTH challenge silently dropped pre-login (`getSigner()` returned null on connections opened during boot) | `RelayConnection` now caches the unanswered challenge (`pendingAuthChallenge`); `relayManager.replayAuth()` re-attempts AUTH after `loginFlow` dispatches `login(...)` |
| 3 | Production relay's `RELAY_URL` env was unset → AUTH event's `relay` tag mismatched the server's expected URL → AUTH always failed | Set `RELAY_URL: wss://relay.thewired.app` in `/opt/thewired/docker-compose.prod.yml`. Committed default `${RELAY_URL:-ws://localhost:7777}` to repo `docker-compose.yml` |
| 4 | Migration `0015_seed_spaces.sql` baked `ws://localhost:7777` into prod's `app.spaces.host_relay` for all 27 seed spaces; built clients then routed kind:9 to nonexistent localhost | One-time UPDATE on prod DB. Migration patched to read from `current_setting('app.relay_host')` GUC. Client-side auto-heal in `spaceStore.ts:loadSpaces` rewrites cached `ws://localhost:7777` to current `APP_RELAY` on load |
| 5 | Suspected admin/membership misconfiguration | Verified `creator_pubkey` and `app.space_members` are correct for the seed spaces. Not a bug, but ruled out as a cause |

---

## Phase 1 — Subscription cap exhaustion (shipped)

### Problem

Both ends had a 20-subscription-per-connection cap (`relayConnection.ts:13`, `services/relay/src/protocol/subscription.rs:10`). For users with many cached spaces:

- `loginFlow.ts` schedules ~5 priority subs to `wss://relay.thewired.app` (relay list, DM list, user metadata, music, music-tagged) before bg chat subs.
- `startBackgroundChatSubs` opens **one bg chat sub per joined space** — for 9-Alpha that was 27.
- Plus gift wrap and follower subs after.
- Total: ~34 subs targeting one relay.

Three failure modes compounded:

1. **Off-by-one in client cap check** — `relayConnection.ts:198` was `if (activeSent >= maxSubs)` but `activeSent` already included the new sub from the prior `subscriptions.set`. Practical client cap was 19.
2. **Subs past the cap got deferred and stayed deferred** — `drainDeferred` only fires from `closeSubscription`. Bg chat subs are never closed; deferred subs sat forever. For 9-Alpha, **the channel REQ when entering chat was sub #35 → deferred → never sent → no historical messages**.
3. **resubscribe ignored the cap on reconnect** — sent all `this.subscriptions` entries; relay rejected overflow with `["CLOSED","subId","error: too many subscriptions"]`; client's CLOSED handler permanently deleted them from `this.subscriptions`. So every reconnect lost a few subs.

This explained why 9-Alpha (27 spaces) was "most affected" while users with 1-3 spaces "sometimes worked, sometimes stopped after a while".

### Fix

| File | Change |
|---|---|
| `client/src/lib/nostr/relayConnection.ts:13` | `DEFAULT_MAX_SUBS` 20 → 100 |
| `client/src/lib/nostr/relayConnection.ts:198-204` | `>=` → `>` (off-by-one) with comment explaining `activeSent` semantics |
| `client/src/lib/nostr/relayConnection.ts::resubscribe()` | Now resets `deferredSubs` (server state is fresh after reconnect) and pre-splits entries into to-send vs. to-defer respecting `maxSubscriptions` |
| `services/relay/src/protocol/subscription.rs:10` | `MAX_SUBSCRIPTIONS` 20 → 100 |
| `services/relay/src/server.rs:112` | NIP-11 `max_subscriptions` 20 → 100 |

### Cap sizing rationale

100 subs × ~1KB/Filter ≈ 100KB per connection. For 1k concurrent users on `t4g.large`: ~100MB extra memory vs. the old cap. Negligible.

The hot CPU path is `subs.matching_subs(&event)` on every broadcast. With cap 100 vs. 20, that's 5× more `Filter::matches` calls per connection per broadcast. Each call is ~1µs for chat-shaped filters. Even at 100 broadcasts/sec across 1k connections, total CPU is well under 10 cores. **If event rates ever spike to thousands/sec, the win is hashing `authors`/`#h` arrays into HashSets at sub-registration, not lowering the cap.**

### Tests

- **Rust unit tests** (`services/relay/src/protocol/subscription.rs::tests`):
  - `accepts_up_to_max_subscriptions` — 100 distinct subs all accepted
  - `rejects_overflow_with_too_many_subscriptions_error` — 101st rejected with the canonical error string
  - `close_frees_slot_for_new_subscription` — close opens a slot
  - `reusing_sub_id_does_not_consume_cap_slot` — same sub_id is upsert; critical for resubscribe correctness on reconnect
- **Vitest tests** (`client/src/lib/nostr/__tests__/relayConnection.test.ts`):
  - `subscription cap` describe block: cap behavior, off-by-one regression, deferred-drain on close
  - `resubscribe respects cap` describe block: reconnect doesn't blow the cap, deferred queue rebuilt fresh, no subs lost
- **Stress tests** (`services/relay/tests/stress_subs.rs`, `#[ignore]` by default):
  - `cap_accepts_100_then_rejects_101` — full WS protocol verification of the cap
  - `many_concurrent_connections_each_50_subs` — 20 parallel connections × 50 subs each, sanity check under concurrent load

  Run against a live relay:
  ```sh
  pnpm dev:infra && pnpm dev:relay   # in another shell
  cd services/relay && cargo test --test stress_subs -- --ignored --nocapture
  ```

### Deploy ordering

Server first. If the client is bumped to 100 while the relay still caps at 20, the relay will CLOSE overflow and the client's CLOSED handler will permanently delete those subs from its tracking — strictly worse than the bug we fixed.

1. Deploy new relay image (Docker/cargo build → push to prod)
2. Verify NIP-11 advertises `max_subscriptions: 100` (`curl -H 'Accept: application/nostr+json' https://relay.thewired.app`)
3. Ship new client (Tauri build + web bundle)

### What this does NOT fix

The other two hypotheses from the investigation are still real and tracked below.

---

## Phase 2 — Broadcast filter doesn't check space membership (NOT shipped)

### Problem

`services/relay/src/connection.rs:24-47` `is_event_visible_to()` is the gate every broadcast event passes through before subscription matching. For an h-tagged event, the function keeps the event only if:

- the client is the author, OR
- the client is p-tagged in the event.

It does **not** check `app.space_members`. So when a member of `seed0000001b` publishes a kind:9 with `["h", "seed0000001b"]`, that event is broadcast to every connection, but `is_event_visible_to` filters it out for every other space member who isn't explicitly @-mentioned. Other members **never see live messages** — they only see history when they trigger a fresh REQ (which uses the proper member-aware query at `event_store.rs:208-228`).

This explains the "switch spaces and back" workaround: switching forces a new REQ.

The author's comment "broadcast leaks are a lower-priority gap covered by h-tag matching in the subscription filter" is a misunderstanding — `is_event_visible_to` runs **before** `subs.matching_subs()`, so the filter never sees the event.

### Fix sketch

Cache the user's space membership set in per-connection state:

1. Add `space_memberships: HashSet<String>` to connection-local state in `connection.rs`.
2. On AUTH success in `handle_auth`: query `SELECT space_id FROM app.space_members WHERE pubkey = $1`, populate the set.
3. Refresh on inbound NIP-29 membership-change events targeting the authed pubkey:
   - kind:9000 (put-user) → add space
   - kind:9001 (remove-user) → remove space
   - kind:9021 (join request acceptance) → add
   - kind:9022 (leave) → remove
4. `is_event_visible_to` consults the set: keep h-tagged events when `space_memberships.contains(h_tag)`.

Cost: one indexed DB query per AUTH (fast), then constant-time set lookups on every broadcast. Cache invalidation only when relevant events arrive.

Membership changes initiated by other admins (kind:9000 with the affected user being someone else) need to broadcast to the affected user's connection. The simplest approach: make `handle_put_user` / `handle_remove_user` notify any connection whose `authed_pubkey` matches the targeted user. A `tokio::sync::broadcast` channel keyed on pubkey works; or just let the connection re-query on receipt of any kind:9000/9001 with `["p", self_pubkey]`.

### Tests to add (write alongside fix)

- `broadcast_reaches_space_members` — two AUTHed conns, both in `app.space_members`. conn1 publishes kind:9 with h-tag. conn2 receives via broadcast.
- `broadcast_blocked_for_non_member` — same, but conn2 not in members. conn2 does NOT receive.
- `membership_change_invalidates_cache` — admin kind:9001 removes a user from a space; user's subsequent broadcasts in that space are blocked.
- `broadcast_reaches_p_tagged_non_member` — backward-compat: someone @-mentioned in a kind:9 still receives it even if not a space member (current behavior; should be preserved).

These can be added to `services/relay/tests/stress_subs.rs` (or split into a separate `tests/broadcast_visibility.rs`).

---

## Phase 3 — REQ races AUTH on every WebSocket connect (NOT shipped)

### Problem

In `relayConnection.ts::connect()`:

```ts
this.ws.onopen = () => {
  ...
  this.setStatus("connected");   // synchronous → forwardPendingSubscriptions
  this.flushQueue();
  this.resubscribe();             // synchronous → all REQs on the wire
};
```

`setStatus("connected")` synchronously fires `onStatusChange`, which the relayManager wires to `forwardPendingSubscriptions` (line 67). `resubscribe()` then sends every entry in `this.subscriptions`. **All REQs are pushed onto the WS before the onmessage queue has been drained**, so the buffered AUTH challenge frame from the server hasn't been read yet.

The AUTH challenge is processed in the next onmessage, then `tryAuth` calls `signer.signEvent` (50-200ms async for Tauri keychain). The AUTH response is sent only after the promise resolves.

Server-side ordering:

1. server receives REQ (no AUTH yet) → `event_store.rs:230-234` for `authed_pubkey: None` returns only `WHERE visibility IS NULL AND h_tag IS NULL` — zero h-tagged events.
2. server sends EOSE.
3. server receives AUTH (200ms later) → sets `authed_pubkey`. But the historical query is already done.

Effect: cold-start initial fetches and every reconnect cause h-tagged subs to receive zero history. The bg chat sub at `loginFlow.ts:800` runs into this on cold start (though `startBackgroundChatSubs` is far enough into the login flow that AUTH is usually done by then). The channel REQ when a user enters chat after a reconnect always loses the race.

### Fix sketch (client-side, gated)

Add `authState` machine to `RelayConnection`:

```ts
type AuthState = "none" | "challenged" | "authed";
private authState: AuthState = "none";
private queuedReqs: Array<{ subId: string; filters: NostrFilter[] }> = [];
```

State transitions:

- On AUTH challenge received → `challenged`
- On `OK` for our AUTH event with `success=true` → `authed`, flush queued REQs
- 1-second grace timeout from `connected`: if no challenge arrived → `authed` (relay doesn't require AUTH)
- On `onclose` → reset to `none`

`subscribe()` / `resubscribe()` behavior:

- If `authState === "challenged"`, push to `queuedReqs` instead of sending.
- If `authState !== "challenged"`, send normally (existing path).

Non-REQ messages (publish events, AUTH responses, CLOSEs) still flush via the existing `messageQueue` regardless of authState.

### Tests to add (write alongside fix)

- `req_queued_until_auth_ok` — connect, simulate AUTH challenge from server, subscribe → REQ held; simulate AUTH OK → REQ goes on the wire.
- `req_flushed_after_grace_timeout` — connect to a relay that never sends AUTH; after 1s, REQ flushes.
- `req_sent_immediately_when_relay_doesnt_challenge` — relay accepts WS without sending AUTH; first REQ goes on the wire normally without a 1s wait (i.e., grace-timeout fallback only kicks in when needed).
- Server-side integration: `req_before_auth_returns_zero` (current bug, marked `#[ignore]` → flips to passing once Phase 3 ships) and `req_after_auth_returns_history` (baseline).

---

## Lower-priority cleanups

These were noticed during the investigation but aren't urgent:

- **Coalesce bg chat subs by host_relay.** Currently `startBackgroundChatSubs` opens one sub per space. With NIP-01's array-of-values semantics for `#h`, all spaces sharing a host_relay can be served by one sub: `{kinds: [9,5,9005], "#h": [id1, ..., idN], since}`. Server filter (`event_store.rs:172-176`) already binds `h_tag = ANY($N)`. This collapses the largest sub user from N to 1. Complication: `closeBgChatSub(spaceId)` would need to recreate the shared sub minus that space, since closing the shared sub closes it for everyone.
- **`getReconnectSince` is dead code.** `subscriptionManager.ts:93-99` is defined but never called. `latestEventAt` tracking is wasted. Either wire it up to the reconnect path so resubscribed REQs use a fresh `since`, or delete both.
- **Redundant Redux dispatch in `useChat.sendMessage`.** Lines 106-109 dispatch `addEvent` + `indexChatMessage`, but `signAndPublish → processIncomingEvent("local")` already does both via the event pipeline. The duplicate dispatches are no-ops thanks to the entity adapter, but wasteful.
- **CLOSED handler doesn't `drainDeferred`.** Currently only `closeSubscription` calls drain. If we ever exceed cap and the relay CLOSEs us, we don't try to fill the freed slot. With cap=100 this rarely fires. **Caveat: drain-on-CLOSED can busy-loop if the relay is rejecting because of its own cap (server cap is hit; we send another deferred sub; server rejects it too).** Only safe to add when client and server caps are kept in lockstep.
- **Concurrent `tryAuth` for the same challenge can double-sign.** `signer.signEvent` is called outside `signingQueue`. Two concurrent calls (e.g., handleMessage + replayAuth firing at nearly the same time) both sign and send. Server is idempotent on AUTH for the same challenge; harmless. Worth fixing if AUTH activity becomes noisy in metrics.

---

## Stress / load testing

`services/relay/tests/stress_subs.rs` is the entry point for protocol-level stress tests. Tests are `#[ignore]` by default — run them against a live relay:

```sh
pnpm dev:infra && pnpm dev:relay   # in another shell
cd services/relay
cargo test --test stress_subs -- --ignored --nocapture
```

Override the target relay with `STRESS_RELAY_URL=ws://...`. As Phase 2/3 fixes land, add the integration tests listed in those sections to this file.

For higher-concurrency capacity work (1k+ clients, sustained throughput), the tests are a starting point but you'd want a proper load harness (e.g., a separate Rust binary spinning thousands of `tokio_tungstenite` clients) writing to histograms — out of scope here.
