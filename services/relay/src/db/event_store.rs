use serde_json::Value;
use sqlx::{PgPool, Postgres};

use crate::db::{community, moderation};
use crate::nostr::access;
use crate::nostr::event::Event;
use crate::nostr::filter::Filter;
use crate::nostr::firehose::{self, FirehosePolicy};
use crate::nostr::report_gate::KIND_REPORT;
use crate::nostr::wrap_gate::{event_expiration, ReadCtx, KIND_GIFT_WRAP};

/// Upper bound on ids a single NIP-77 reconciliation may cover.
pub const MAX_NEG_IDS: i64 = 20_000;

/// Hard cap on rows returned per query, matching strfry's 500 (RELAY_OPTIMIZATIONS
/// §1). A client cannot tie up a DB connection with `limit: 5000`.
const MAX_QUERY_LIMIT: i64 = 500;

/// Replaceable event kinds: only one event per pubkey+kind (NIP-01)
fn is_replaceable(kind: i32) -> bool {
    kind == 0 || kind == 3 || (10000..20000).contains(&kind)
}

/// Addressable event kinds: only one event per pubkey+kind+d_tag (NIP-01)
fn is_addressable(kind: i32) -> bool {
    (30000..40000).contains(&kind)
}

/// Store an event in the database.
/// Handles replaceable (kinds 0, 3, 10000-19999) and addressable (kinds 30000-39999)
/// events by replacing older versions for the same pubkey+kind (or pubkey+kind+d_tag).
pub async fn store_event(pool: &PgPool, event: &Event) -> anyhow::Result<bool> {
    store_event_flagged(pool, event, false).await
}

/// Store an event, recording whether it is a self-published gift wrap
/// (docs/DM_WIRE_CONTRACT.md §7.3) and its NIP-40 `expiration`.
pub async fn store_event_flagged(
    pool: &PgPool,
    event: &Event,
    self_published: bool,
) -> anyhow::Result<bool> {
    // NIP-01: an addressable event with no `d` tag has the empty-string
    // address. Storing NULL there put every such event outside the unique
    // index, so unlimited "versions" of one address accumulated (audit 2026-10).
    let d_tag = match event.get_tag_value("d") {
        Some(d) => Some(d),
        None if is_addressable(event.kind) => Some(String::new()),
        None => None,
    };
    let expires_at = event_expiration(event);
    // Every h tag goes into the indexed `h_tags` array (multi-space events);
    // the scalar `h_tag` column is kept as h_tags[1] so `h_tag IS NULL` still
    // means "public" for the backend queries that read it.
    let h_tags = event.get_tag_values("h");
    let h_tag = h_tags.first().cloned();
    let visibility = event.get_tag_value("visibility");
    let tags_json: Value = serde_json::to_value(&event.tags)?;

    // Extract p/e tag values into dedicated array columns for fast filtering
    // (RELAY_OPTIMIZATIONS §2). Mirrors the query-side `p_tags && $N` path.
    let p_tags = event.get_tag_values("p");
    let e_tags = event.get_tag_values("e");

    // Replace + insert run in one transaction so a crash between them cannot
    // lose the only copy of a replaceable event (audit 2026-10).
    let mut tx = pool.begin().await?;

    // For replaceable/addressable events, delete the version this one
    // supersedes first: an older one, or — NIP-01 tie-break — one with the same
    // created_at and a lexically greater id (the lowest id is retained). If
    // the existing event wins, the delete matches nothing and the insert fails
    // on the unique constraint; that is reported as Ok(false) ("superseded").
    if is_replaceable(event.kind) {
        sqlx::query(
            "DELETE FROM relay.events WHERE pubkey = $1 AND kind = $2 \
             AND (created_at < $3 OR (created_at = $3 AND id > $4))",
        )
        .bind(&event.pubkey)
        .bind(event.kind)
        .bind(event.created_at)
        .bind(&event.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!(kind = event.kind, error = %e, "Failed to delete old replaceable event");
            e
        })?;
    } else if is_addressable(event.kind) {
        if let Some(ref d) = d_tag {
            sqlx::query(
                "DELETE FROM relay.events WHERE pubkey = $1 AND kind = $2 AND d_tag = $3 \
                 AND (created_at < $4 OR (created_at = $4 AND id > $5))",
            )
            .bind(&event.pubkey)
            .bind(event.kind)
            .bind(d)
            .bind(event.created_at)
            .bind(&event.id)
            .execute(&mut *tx)
            .await
            .map_err(|e| {
                tracing::error!(kind = event.kind, error = %e, "Failed to delete old addressable event");
                e
            })?;
        }
    }

    // The two NOT EXISTS legs refuse an event a prior NIP-09 / NIP-29 deletion
    // covers (security audit 2026-10). The handler checks `is_deleted` first
    // and answers `deleted:`; this guard makes the store itself safe.
    let result = sqlx::query(
        r#"
        INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, d_tag, h_tag, visibility, p_tags, e_tags, h_tags, expires_at, self_published)
        SELECT $1::text, $2::text, $3::bigint, $4::int, $5::jsonb, $6::text, $7::text, $8::text, $9::text, $10::text, $11::text[], $12::text[], $13::text[], $14::bigint, $15::boolean
        WHERE NOT EXISTS (SELECT 1 FROM relay.deleted_events WHERE event_id = $1 AND pubkey = $2)
          AND NOT EXISTS (SELECT 1 FROM relay.deleted_addresses
                          WHERE kind = $4 AND pubkey = $2 AND d_tag = COALESCE($8, '') AND deleted_upto >= $3)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(&event.id)
    .bind(&event.pubkey)
    .bind(event.created_at)
    .bind(event.kind)
    .bind(&tags_json)
    .bind(&event.content)
    .bind(&event.sig)
    .bind(&d_tag)
    .bind(&h_tag)
    .bind(&visibility)
    .bind(&p_tags)
    .bind(&e_tags)
    .bind(&h_tags)
    .bind(expires_at)
    .bind(self_published)
    .execute(&mut *tx)
    .await;

    match result {
        Ok(r) => {
            tx.commit().await?;
            Ok(r.rows_affected() > 0)
        }
        Err(e) => {
            // Nothing to keep: the delete above (if any) must not survive a
            // failed insert.
            let _ = tx.rollback().await;
            // Unique constraint violation for replaceable/addressable means
            // the existing event is newer — not an error, just a no-op.
            if is_replaceable(event.kind) || is_addressable(event.kind) {
                if let sqlx::Error::Database(ref db_err) = e {
                    if db_err.constraint().is_some() {
                        tracing::debug!(
                            event_id = &event.id[..12],
                            kind = event.kind,
                            "Replaceable event superseded by existing newer event"
                        );
                        return Ok(false);
                    }
                }
            }
            tracing::error!(
                event_id = &event.id[..12],
                kind = event.kind,
                error = %e,
                "DB store failed"
            );
            Err(e.into())
        }
    }
}

/// Dynamic bind values for the hand-built WHERE clause. sqlx doesn't support
/// heterogeneous dynamic binding, so we build `$N` placeholders and bind in
/// order.
enum BindValue {
    StringVec(Vec<String>),
    IntVec(Vec<i32>),
    Int64(i64),
    Str(String),
}

/// Build the WHERE conditions + ordered binds for `filter` under `ctx`.
/// Shared by the REQ query, the NIP-77 id listing and (in spirit) the search
/// path so the visibility, gift-wrap and expiration rules can't drift.
fn build_conditions(filter: &Filter, ctx: &ReadCtx<'_>) -> (Vec<String>, Vec<BindValue>) {
    let mut conditions: Vec<String> = Vec::new();
    let mut param_counter: usize = 0;
    let mut binds: Vec<BindValue> = Vec::new();

    // ids: WHERE id = ANY($N)
    if !filter.ids.is_empty() {
        param_counter += 1;
        conditions.push(format!("id = ANY(${param_counter})"));
        binds.push(BindValue::StringVec(filter.ids.clone()));
    }

    // authors: WHERE pubkey = ANY($N)
    if !filter.authors.is_empty() {
        param_counter += 1;
        conditions.push(format!("pubkey = ANY(${param_counter})"));
        binds.push(BindValue::StringVec(filter.authors.clone()));
    }

    // kinds: WHERE kind = ANY($N)
    if !filter.kinds.is_empty() {
        param_counter += 1;
        conditions.push(format!("kind = ANY(${param_counter})"));
        binds.push(BindValue::IntVec(filter.kinds.clone()));
    }

    // since: WHERE created_at >= $N
    if let Some(since) = filter.since {
        param_counter += 1;
        conditions.push(format!("created_at >= ${param_counter}"));
        binds.push(BindValue::Int64(since));
    }

    // until: WHERE created_at <= $N
    if let Some(until) = filter.until {
        param_counter += 1;
        conditions.push(format!("created_at <= ${param_counter}"));
        binds.push(BindValue::Int64(until));
    }

    // first_seen_since (relay-internal, lag resync): rows stored at or after
    // this server time, whatever their `created_at`.
    if let Some(first_seen_since) = filter.first_seen_since {
        param_counter += 1;
        conditions.push(format!("first_seen >= to_timestamp(${param_counter})"));
        binds.push(BindValue::Int64(first_seen_since));
    }

    // h_tags: array overlap against the indexed `h_tags` column, so a `#h`
    // filter matches an event whose SECOND (or later) h tag is the filtered id.
    if !filter.h_tags.is_empty() {
        param_counter += 1;
        conditions.push(format!("h_tags && ${param_counter}"));
        binds.push(BindValue::StringVec(filter.h_tags.clone()));
    }

    // d_tags: WHERE d_tag = ANY($N)
    if !filter.d_tags.is_empty() {
        param_counter += 1;
        conditions.push(format!("d_tag = ANY(${param_counter})"));
        binds.push(BindValue::StringVec(filter.d_tags.clone()));
    }

    // p_tags / e_tags: array overlap against the indexed columns (GIN-backed,
    // RELAY_OPTIMIZATIONS §2). `p_tags && $N` is true when the event shares any
    // p-tag value with the filter — same OR semantics as the old jsonb scan.
    if !filter.p_tags.is_empty() {
        param_counter += 1;
        conditions.push(format!("p_tags && ${param_counter}"));
        binds.push(BindValue::StringVec(filter.p_tags.clone()));
    }

    if !filter.e_tags.is_empty() {
        param_counter += 1;
        conditions.push(format!("e_tags && ${param_counter}"));
        binds.push(BindValue::StringVec(filter.e_tags.clone()));
    }

    // Generic single-letter `#x` tag filters (#69). Not column-indexed like
    // p_tags/e_tags, so match against the jsonb `tags` array. Only evaluated when
    // a generic tag filter is actually present.
    for (name, values) in &filter.generic_tags {
        let name_param = {
            param_counter += 1;
            binds.push(BindValue::Str(name.clone()));
            param_counter
        };
        let values_param = {
            param_counter += 1;
            binds.push(BindValue::StringVec(values.clone()));
            param_counter
        };
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(tags) t WHERE t->>0 = ${name_param} AND t->>1 = ANY(${values_param}))"
        ));
    }

    // NIP-40: never serve an expired event, even if it is still stored.
    {
        param_counter += 1;
        conditions.push(format!("(expires_at IS NULL OR expires_at > ${param_counter})"));
        binds.push(BindValue::Int64(ctx.now));
    }

    // Visibility access control: filter protected events based on authenticated pubkey.
    // - Private/unlisted events: only visible to author or p-tagged collaborators
    // - Space-scoped events (h_tag): only visible to author or space members
    // - Public events (no visibility, no h_tag): visible to everyone
    // - Gift wraps (kind 1059): only to the authenticated p-tagged recipient
    //   (docs/DM_WIRE_CONTRACT.md §7.1) unless the connection holds the
    //   ingest role / the gate is not enforced.
    // - Reports (kind 1984): only to their authenticated author, unless the
    //   connection holds the ingest role (nostr::report_gate).
    match ctx.authed {
        Some(pk) => {
            param_counter += 1;
            let auth_param = param_counter;
            binds.push(BindValue::StringVec(vec![pk.to_string()]));

            // One predicate for every protected shape (nostr::access): the
            // author, an access-granting p tag (role-aware), or — for `h`-only
            // events — a member of ANY listed space in EITHER the backend world
            // (app.space_members) OR the relay-native one (relay.group_members);
            // the ingest role (`serve_all_spaces`) is a member of every space.
            // `h_tags && ARRAY(...)` is the any-of leg for multi-space events.
            // The indexed `p_tags` text[] pre-filters the jsonb role check so
            // the per-row scan only runs for rows that name the reader (#114).
            let pk = format!("${auth_param}[1]");
            let members_any = access::pg_members_any(&pk, ctx.serve_all_spaces);
            conditions.push(access::pg_visible_predicate(&pk, &members_any, ""));

            if !ctx.serve_all_wraps {
                conditions.push(format!(
                    "(kind <> {KIND_GIFT_WRAP} OR ${auth_param}[1] = ANY(p_tags))"
                ));
            }
            if !ctx.serve_all_reports {
                conditions.push(format!("(kind <> {KIND_REPORT} OR pubkey = ${auth_param}[1])"));
            }
            // Shadowed authors (migration 008) are served only to themselves.
            conditions.push(moderation::pg_not_shadowed_predicate(Some(&pk)));
        }
        None => {
            // Unauthenticated: only public events (no visibility tag, no h_tag)
            conditions.push(access::pg_anonymous_predicate(""));
            if !ctx.serve_all_wraps {
                conditions.push(format!("kind <> {KIND_GIFT_WRAP}"));
            }
            if !ctx.serve_all_reports {
                conditions.push(format!("kind <> {KIND_REPORT}"));
            }
            conditions.push(moderation::pg_not_shadowed_predicate(None));
        }
    }

    // Firehose policy (`nostr::firehose`): an untargeted timeline request
    // under `community` returns community authors and the reader's own notes.
    // Targeted filters never reach this branch, so threads, mentions,
    // profiles and ids are served exactly as above.
    if ctx.firehose_policy == FirehosePolicy::Community && firehose::is_firehose(filter) {
        param_counter += 1;
        conditions.push(community::pg_community_firehose_predicate(&format!("${param_counter}")));
        binds.push(BindValue::StringVec(ctx.authed.map(|pk| vec![pk.to_string()]).unwrap_or_default()));
    }

    (conditions, binds)
}

fn where_clause(conditions: &[String]) -> String {
    if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    }
}

macro_rules! bind_all {
    ($query:expr, $binds:expr) => {{
        let mut q = $query;
        for bind in $binds.iter() {
            q = match bind {
                BindValue::StringVec(v) => q.bind(v),
                BindValue::IntVec(v) => q.bind(v),
                BindValue::Int64(v) => q.bind(v),
                BindValue::Str(v) => q.bind(v),
            };
        }
        q
    }};
}

/// Query events matching a filter with dynamic WHERE clauses (pre-contract
/// signature: no ingest role, gate enforced, wall-clock now).
pub async fn query_events(pool: &PgPool, filter: &Filter, authed_pubkey: Option<&str>) -> anyhow::Result<Vec<Event>> {
    query_events_ctx(pool, filter, &ReadCtx::plain(authed_pubkey)).await
}

/// Query events matching a filter under a full read context.
pub async fn query_events_ctx(pool: &PgPool, filter: &Filter, ctx: &ReadCtx<'_>) -> anyhow::Result<Vec<Event>> {
    if let Some(ref search_query) = filter.search {
        return search_events_ctx(pool, filter, search_query, ctx).await;
    }

    let start = std::time::Instant::now();
    let (conditions, binds) = build_conditions(filter, ctx);
    let where_clause = where_clause(&conditions);

    // Clamp to [0, MAX] so a negative limit can't bypass the cap (#70).
    let limit = filter.limit.unwrap_or(MAX_QUERY_LIMIT).clamp(0, MAX_QUERY_LIMIT);
    let sql = format!(
        "SELECT id, pubkey, created_at, kind, tags, content, sig FROM relay.events {where_clause} ORDER BY created_at DESC LIMIT {limit}"
    );

    let query = bind_all!(sqlx::query_as::<Postgres, EventRow>(&sql), binds);
    let events: Vec<EventRow> = query.fetch_all(pool).await?;

    let elapsed = start.elapsed();
    if elapsed.as_millis() > 50 {
        tracing::warn!(
            elapsed_ms = elapsed.as_millis() as u64,
            results = events.len(),
            kinds = ?filter.kinds,
            "Slow query"
        );
    }

    Ok(events
        .into_iter()
        .map(|r| Event {
            id: r.id,
            pubkey: r.pubkey,
            created_at: r.created_at,
            kind: r.kind,
            tags: serde_json::from_value(r.tags).unwrap_or_default(),
            content: r.content,
            sig: r.sig,
        })
        .collect())
}

/// NIP-50 full-text search under the FULL filter — `kinds`, `authors`, `#h`,
/// `since`/`until`, tag filters — and the same read gates as a plain REQ.
/// Before, only the query and the limit reached the search, so a search
/// scoped to one space or one author answered from the whole relay (audit
/// 2026-09-18 C-01). Gift wraps and reports are never searchable whatever
/// the role: their content is ciphertext / the reporter's note. The limit is
/// clamped like every REQ so a search can't tie up a connection (strfry caps
/// at 500; RELAY_OPTIMIZATIONS §1).
pub async fn search_events_ctx(
    pool: &PgPool,
    filter: &Filter,
    query: &str,
    ctx: &ReadCtx<'_>,
) -> anyhow::Result<Vec<Event>> {
    let (mut conditions, mut binds) = build_conditions(filter, ctx);
    binds.push(BindValue::Str(query.to_string()));
    let q_param = binds.len();
    conditions.push(format!("search_tsv @@ plainto_tsquery('english', ${q_param})"));
    conditions.push(format!("kind <> {KIND_GIFT_WRAP}"));
    conditions.push(format!("kind <> {KIND_REPORT}"));
    let where_clause = where_clause(&conditions);
    let limit = filter.limit.unwrap_or(100).clamp(0, MAX_QUERY_LIMIT);
    let sql = format!(
        "SELECT id, pubkey, created_at, kind, tags, content, sig FROM relay.events {where_clause} \
         ORDER BY ts_rank(search_tsv, plainto_tsquery('english', ${q_param})) DESC LIMIT {limit}"
    );
    let query = bind_all!(sqlx::query_as::<Postgres, EventRow>(&sql), binds);
    let rows: Vec<EventRow> = query.fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|r| Event {
            id: r.id,
            pubkey: r.pubkey,
            created_at: r.created_at,
            kind: r.kind,
            tags: serde_json::from_value(r.tags).unwrap_or_default(),
            content: r.content,
            sig: r.sig,
        })
        .collect())
}

/// `(created_at, id)` of every event matching `filter` under `ctx`, oldest
/// first — the input to a NIP-77 negentropy storage vector. Returns at most
/// `max + 1` rows so the caller can detect "too many" and answer
/// `NEG-ERR blocked`. Search filters are not reconcilable.
pub async fn query_event_ids(
    pool: &PgPool,
    filter: &Filter,
    ctx: &ReadCtx<'_>,
    max: i64,
) -> anyhow::Result<Vec<(i64, String)>> {
    if filter.search.is_some() {
        return Ok(Vec::new());
    }
    let (conditions, binds) = build_conditions(filter, ctx);
    let where_clause = where_clause(&conditions);
    let limit = max.max(0) + 1;
    let sql = format!(
        "SELECT created_at, id FROM relay.events {where_clause} ORDER BY created_at ASC, id ASC LIMIT {limit}"
    );
    let query = bind_all!(sqlx::query_as::<Postgres, (i64, String)>(&sql), binds);
    Ok(query.fetch_all(pool).await?)
}

/// NIP-40 sweeper: delete every event whose `expiration` has passed.
pub async fn delete_expired(pool: &PgPool, now: i64) -> anyhow::Result<u64> {
    let r = sqlx::query("DELETE FROM relay.events WHERE expires_at IS NOT NULL AND expires_at <= $1")
        .bind(now)
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}

/// Server-side gift-wrap retention: delete kind-1059 rows first seen more
/// than `days` days ago (`RELAY_WRAP_RETENTION_DAYS`).
pub async fn delete_wraps_older_than_days(pool: &PgPool, days: u32) -> anyhow::Result<u64> {
    if days == 0 {
        return Ok(0);
    }
    let r = sqlx::query(
        "DELETE FROM relay.events WHERE kind = $1 AND first_seen < NOW() - make_interval(days => $2)",
    )
    .bind(KIND_GIFT_WRAP)
    .bind(days as i32)
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// Was this stored event a self-published gift wrap? (The backend reads the
/// column by SQL too; this is for tests and the embedded relay.)
pub async fn is_self_published(pool: &PgPool, event_id: &str) -> anyhow::Result<bool> {
    let row: Option<(bool,)> = sqlx::query_as("SELECT self_published FROM relay.events WHERE id = $1")
        .bind(event_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.0).unwrap_or(false))
}

/// Get an event by ID (for author verification in deletion)
pub async fn get_event_by_id(pool: &PgPool, event_id: &str) -> anyhow::Result<Option<Event>> {
    let row: Option<EventRow> = sqlx::query_as(
        "SELECT id, pubkey, created_at, kind, tags, content, sig FROM relay.events WHERE id = $1",
    )
    .bind(event_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| Event {
        id: r.id,
        pubkey: r.pubkey,
        created_at: r.created_at,
        kind: r.kind,
        tags: serde_json::from_value(r.tags).unwrap_or_default(),
        content: r.content,
        sig: r.sig,
    }))
}

/// Remember that `event_id` (authored by `pubkey`) was deleted by `deleted_by`,
/// so a re-publish is refused (`relay.deleted_events`, migration 007).
pub async fn record_deleted_event(
    pool: &PgPool,
    event_id: &str,
    pubkey: &str,
    deleted_by: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO relay.deleted_events (event_id, pubkey, deleted_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    )
    .bind(event_id)
    .bind(pubkey)
    .bind(deleted_by)
    .execute(pool)
    .await?;
    Ok(())
}

/// Remember a NIP-09 `a`-tag deletion: every version of `(kind, pubkey, d_tag)`
/// created at or before `deleted_upto` is refused from now on. A later
/// deletion only ever moves the bound forward.
pub async fn record_deleted_address(
    pool: &PgPool,
    kind: i32,
    pubkey: &str,
    d_tag: &str,
    deleted_upto: i64,
    deleted_by: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO relay.deleted_addresses (kind, pubkey, d_tag, deleted_upto, deleted_by) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (kind, pubkey, d_tag) DO UPDATE \
         SET deleted_upto = GREATEST(relay.deleted_addresses.deleted_upto, EXCLUDED.deleted_upto)",
    )
    .bind(kind)
    .bind(pubkey)
    .bind(d_tag)
    .bind(deleted_upto)
    .bind(deleted_by)
    .execute(pool)
    .await?;
    Ok(())
}

/// Does a recorded deletion cover this event — its id (for its author), or
/// its address at or before the deletion?
pub async fn is_deleted(pool: &PgPool, event: &Event) -> anyhow::Result<bool> {
    let d_tag = event.get_tag_value("d").unwrap_or_default();
    let (hit,): (bool,) = sqlx::query_as(
        "SELECT EXISTS (SELECT 1 FROM relay.deleted_events WHERE event_id = $1 AND pubkey = $2) \
             OR EXISTS (SELECT 1 FROM relay.deleted_addresses \
                        WHERE kind = $3 AND pubkey = $2 AND d_tag = $4 AND deleted_upto >= $5)",
    )
    .bind(&event.id)
    .bind(&event.pubkey)
    .bind(event.kind)
    .bind(&d_tag)
    .bind(event.created_at)
    .fetch_one(pool)
    .await?;
    Ok(hit)
}

/// Delete an event by ID
pub async fn delete_event(pool: &PgPool, event_id: &str) -> anyhow::Result<bool> {
    let result = sqlx::query("DELETE FROM relay.events WHERE id = $1")
        .bind(event_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Unconditionally delete the addressable event for `(kind, pubkey, d_tag)`.
/// Used when the relay re-publishes its OWN group metadata (39000-2): the
/// generic `created_at <` replace would silently drop a same-second update.
pub async fn replace_addressable(
    pool: &PgPool,
    kind: i32,
    pubkey: &str,
    d_tag: &str,
) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM relay.events WHERE kind = $1 AND pubkey = $2 AND d_tag = $3")
        .bind(kind)
        .bind(pubkey)
        .bind(d_tag)
        .execute(pool)
        .await?;
    Ok(())
}

/// NIP-09 `a`-tag deletion: delete the addressable event for `(kind, pubkey,
/// d_tag)` only if it was created at or before `created_at` (newer versions
/// supersede the deletion). Returns the number of rows removed.
pub async fn delete_addressable_upto(
    pool: &PgPool,
    kind: i32,
    pubkey: &str,
    d_tag: &str,
    created_at: i64,
) -> anyhow::Result<u64> {
    let result = sqlx::query(
        "DELETE FROM relay.events WHERE kind = $1 AND pubkey = $2 AND d_tag = $3 AND created_at <= $4",
    )
    .bind(kind)
    .bind(pubkey)
    .bind(d_tag)
    .bind(created_at)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

#[derive(sqlx::FromRow)]
struct EventRow {
    id: String,
    pubkey: String,
    created_at: i64,
    kind: i32,
    tags: Value,
    content: String,
    sig: String,
}
