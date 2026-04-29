# Relay Optimizations Roadmap

Production relay optimization plan based on strfry patterns and codebase analysis.

---

## Low Effort, High Impact

### 1. Clamp Filter Limits

**Why:** A client can send `limit: 5000` and tie up a DB connection. strfry caps at 500. We currently allow up to 5000 in `event_store.rs`.

**Where:** `src/protocol/handler.rs` — clamp before passing to query

```rust
// Before passing filter to query_events
filter.limit = filter.limit.map(|l| l.min(500));
```

Also enforce in `event_store.rs:207` — change the hardcoded 5000 fallback to 500.

---

### 2. Extract `p_tag` and `e_tag` into Indexed Columns

**Why:** Tag queries currently use `jsonb_array_elements()` with `EXISTS` subqueries that do full tag array scans on every row. Dedicated columns with B-tree indexes are 10-100x faster. We already did this for `h_tag` and `d_tag`.

**Where:** New migration + `src/db/event_store.rs`

```sql
-- New migration
ALTER TABLE relay.events ADD COLUMN p_tags TEXT[] DEFAULT '{}';
ALTER TABLE relay.events ADD COLUMN e_tags TEXT[] DEFAULT '{}';

CREATE INDEX idx_events_ptags ON relay.events USING GIN (p_tags);
CREATE INDEX idx_events_etags ON relay.events USING GIN (e_tags);
```

Update `store_event()` to extract p/e tags on insert:

```rust
let p_tags: Vec<&str> = event.tags.iter()
    .filter(|t| t.first().map(|s| s.as_str()) == Some("p"))
    .filter_map(|t| t.get(1).map(|s| s.as_str()))
    .collect();
```

Update `query_events()` to use array containment (`@>`) instead of `jsonb_array_elements()`:

```sql
-- Before (slow)
EXISTS (SELECT 1 FROM jsonb_array_elements(tags) elem
        WHERE elem->>0 = 'p' AND elem->>1 = ANY($N))

-- After (fast)
p_tags && $N  -- array overlap operator
```

---

### 3. Move Schnorr Verification to `spawn_blocking`

**Why:** Signature verification is CPU-bound (SHA-256 hash + secp256k1 schnorr verify). Running it on the async runtime blocks the Tokio event loop. strfry uses a dedicated validator thread.

**Where:** `src/protocol/handler.rs` — wrap the `verify_event()` call

```rust
// Before
if !verify_event(&event) {
    return vec![notice("invalid: bad signature")];
}

// After
let event_clone = event.clone();
let valid = tokio::task::spawn_blocking(move || verify_event(&event_clone))
    .await
    .unwrap_or(false);
if !valid {
    return vec![notice("invalid: bad signature")];
}
```

Also consider caching the `Secp256k1` context as a `static` instead of creating it per-call in `verify.rs`.

---

### 4. Serialize Broadcast Events Once

**Why:** Currently we serialize every event to JSON per subscription match in `connection.rs:84`. For an event broadcast to 100 subscribers, that's 100 redundant `serde_json::to_string()` calls.

**Where:** `src/connection.rs` broadcast loop + `src/protocol/handler.rs` broadcast

```rust
// In handler.rs — broadcast Arc<Event> + pre-serialized JSON
struct BroadcastPayload {
    event: Arc<Event>,
    json: Arc<str>,  // serialized once
}

// In connection.rs — reuse the pre-serialized JSON
let msg = format!(r#"["EVENT","{sub_id}",{}]"#, payload.json);
```

This also eliminates the `Event.clone()` on every broadcast — use `Arc<Event>` instead.

---

### 5. Add `(pubkey, created_at DESC)` Composite Index

**Why:** Author-only queries (no kind filter) currently use `idx_events_pubkey_kind` which lacks time ordering, forcing a filesort. Common query pattern: "give me the latest N events from this author."

**Where:** New migration

```sql
CREATE INDEX idx_events_pubkey_created
ON relay.events (pubkey, created_at DESC);
```

Consider dropping the redundant `idx_events_created` (standalone `created_at DESC`) since `idx_events_kind_created` already covers kind+time queries, and the new index covers author+time.

---

## Medium Effort, High Impact

### 6. WebSocket Compression (permessage-deflate)

**Why:** Nostr messages have high redundancy — repeated pubkeys, kind numbers, tag structures. strfry achieves 40-60% bandwidth reduction. `axum`/`tungstenite` supports this natively.

**Where:** `src/server.rs` — WebSocket upgrade config

```rust
use axum::extract::ws::WebSocketUpgrade;

// Enable permessage-deflate in the WebSocket upgrade
let ws_config = WebSocketConfig {
    max_message_size: Some(128 * 1024),
    ..Default::default()
};
// tungstenite DeflateConfig for compression
```

**Note:** Test with clients that don't support compression — must be negotiated, not forced.

---

### 7. Write Batching

**Why:** Each EVENT triggers an individual INSERT. Under load, this creates excessive DB round trips. strfry batches up to 1,000 events at a time.

**Where:** New write batcher module + `src/protocol/handler.rs`

```
Architecture:
1. Handler sends events into an mpsc channel (non-blocking)
2. Background task drains channel every 100ms or N events (whichever first)
3. Batch pre-checks duplicates: SELECT id FROM relay.events WHERE id = ANY($1)
4. Batch INSERT for non-duplicate events
5. Broadcast after successful insert
```

```rust
// Pseudocode
let (write_tx, mut write_rx) = mpsc::channel::<PendingEvent>(1000);

// Background writer task
tokio::spawn(async move {
    let mut batch = Vec::with_capacity(100);
    let mut interval = tokio::time::interval(Duration::from_millis(100));
    loop {
        tokio::select! {
            Some(event) = write_rx.recv() => {
                batch.push(event);
                if batch.len() >= 100 { flush(&mut batch).await; }
            }
            _ = interval.tick() => {
                if !batch.is_empty() { flush(&mut batch).await; }
            }
        }
    }
});
```

---

## Longer Term

### 8. Query Time-Slicing

**Why:** A single heavy subscription (e.g., `{"kinds": [1], "limit": 500}`) can hold a DB connection for seconds, starving other clients. strfry processes queries in 10ms slices with round-robin fairness.

**Where:** `src/db/event_store.rs` — query execution

**Approach:**
- Add a query timeout per subscription (e.g., 100ms per slice)
- Use cursor-based pagination instead of `LIMIT/OFFSET`
- Round-robin across pending queries in a shared task queue
- Return partial results with EOSE after timeout, allow client to re-request

---

### 9. NIP-77 Negentropy Sync

**Why:** Efficient relay-to-relay synchronization. Instead of re-transmitting all events, negentropy computes set differences and only transfers missing events. There's a Rust `negentropy` crate. Significant competitive feature for relay operators.

**Where:** New module `src/protocol/nip77.rs`

**Approach:**
- Implement negentropy handshake over WebSocket
- Build fingerprint tree from event IDs + timestamps
- Exchange difference messages to identify missing events
- Bulk transfer only missing events

**Dependency:** `negentropy` crate

---

### 10. NIP-42 AUTH — wired; remaining gaps tracked separately

> Status: **largely complete.** The original "stub exists but isn't wired" gap has been fixed: `connection.rs` sends a challenge on connect, `handler.rs:34` routes `["AUTH", ...]` messages to `handle_auth`, the per-connection `authed_pubkey` is plumbed through to `query_events`, and `event_store.rs:208-228` filters protected/h-tagged events by membership for authenticated clients. NIP-11 advertises NIP-42 support.
>
> **Remaining gaps** are documented in [`NIP29_CHAT.md`](./NIP29_CHAT.md):
> - Broadcast filter (`connection.rs::is_event_visible_to`) doesn't check `app.space_members`, so live kind:9 events from other members never reach a subscriber even after AUTH.
> - REQ-AUTH timing race: clients send REQs in their `onopen` handler before receiving / responding to the AUTH challenge, so initial historical fetches return zero h-tagged events.
> - No `auth-required: true` mode for fully private relays (we only enforce membership-based filtering on h-tagged events).

---

## Additional Findings from Codebase Analysis

These issues were identified from reading the relay source and are not in the original list.

### 11. Increase DB Connection Pool

**Current:** `max_connections(20)`, `min_connections(2)` in `src/db/pool.rs`

**Problem:** 20 connections is too low for a relay serving multiple concurrent clients, especially with NIP-29 operations that make multiple DB round trips per event.

**Fix:** Increase to `max_connections(100)`, `min_connections(5)`. Make configurable via environment variable.

---

### 12. Use UPSERT for Replaceable Events

**Current:** `event_store.rs:30-78` does a separate DELETE then INSERT for replaceable (kinds 0, 3, 10000-19999) and addressable (30000-39999) events.

**Fix:** Use a single `INSERT ... ON CONFLICT DO UPDATE` with a `WHERE` guard on `created_at`:

```sql
INSERT INTO relay.events (...) VALUES (...)
ON CONFLICT (pubkey, kind) WHERE kind BETWEEN 10000 AND 19999
DO UPDATE SET ... WHERE EXCLUDED.created_at > relay.events.created_at;
```

Halves write latency for profile updates, contact lists, and relay lists.

---

### 13. Batch NIP-29 Member Operations

**Current:** `src/nostr/nip29/moderation.rs:28-30` adds members one-by-one in a loop.

**Fix:** Batch INSERT with `unnest()`:

```sql
INSERT INTO relay.group_members (group_id, pubkey, added_at)
SELECT $1, unnest($2::text[]), NOW()
ON CONFLICT DO NOTHING;
```

---

### 14. Add Per-Connection Rate Limiting

**Current:** No rate limiting at the connection level. A single client can flood events.

**Fix:** Token bucket per connection in `connection.rs`:

```rust
struct RateLimiter {
    events_per_second: u32,    // e.g., 10
    reqs_per_second: u32,      // e.g., 20
    tokens: f64,
    last_refill: Instant,
}
```

Send `NOTICE` with rate limit message and drop excess events.

---

### 15. Add Query Timeouts

**Current:** No query timeout — a bad filter can run indefinitely and hold a DB connection.

**Fix:** Wrap queries with `SET LOCAL statement_timeout`:

```rust
sqlx::query("SET LOCAL statement_timeout = '500ms'")
    .execute(&mut *tx)
    .await?;
// ... run actual query in same transaction
```

---

### 16. Health Check Should Verify DB

**Current:** The `/health` endpoint always returns OK regardless of database state.

**Fix:** Run `SELECT 1` against the pool and return 503 if it fails:

```rust
async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match sqlx::query("SELECT 1").execute(&state.pool).await {
        Ok(_) => (StatusCode::OK, "ok"),
        Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "db unreachable"),
    }
}
```

---

## Priority Matrix

| # | Optimization | Effort | Impact | Category |
|---|---|---|---|---|
| 1 | Clamp filter limits | Low | High | Resource protection |
| 2 | Extract p_tag/e_tag columns | Low | High | Query performance |
| 3 | spawn_blocking for verify | Low | High | Async correctness |
| 4 | Serialize broadcasts once | Low | High | CPU reduction |
| 5 | pubkey+created_at index | Low | Medium | Query performance |
| 6 | WebSocket compression | Medium | High | Bandwidth |
| 7 | Write batching | Medium | High | Write throughput |
| 8 | Query time-slicing | High | High | Fairness |
| 9 | NIP-77 negentropy | High | High | Feature |
| 10 | NIP-42 AUTH wiring | Medium | High | Security |
| 11 | Increase DB pool | Low | Medium | Resource limits |
| 12 | UPSERT replaceables | Low | Medium | Write latency |
| 13 | Batch NIP-29 members | Low | Low | Write throughput |
| 14 | Per-connection rate limit | Medium | High | DDoS protection |
| 15 | Query timeouts | Low | Medium | Resource protection |
| 16 | Health check with DB | Low | Low | Observability |

---

## Suggested Implementation Order

**Phase 1 — Quick wins (1-2 days):**
Items 1, 3, 5, 11, 12, 15, 16

**Phase 2 — Query performance (2-3 days):**
Items 2, 4, 14

**Phase 3 — Throughput (3-5 days):**
Items 6, 7, 13

**Phase 4 — Production hardening (1-2 weeks):**
Items 8, 10

**Phase 5 — Competitive features (2+ weeks):**
Item 9
