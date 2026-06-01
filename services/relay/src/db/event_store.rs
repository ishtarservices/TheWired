use serde_json::Value;
use sqlx::{PgPool, Postgres};

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// Hard cap on rows returned per query, matching strfry's 500 (RELAY_OPTIMIZATIONS
/// §1). A client cannot tie up a DB connection with `limit: 5000`.
const MAX_QUERY_LIMIT: i64 = 500;

/// Collect the values (`tag[1]`) of every tag whose name (`tag[0]`) matches.
/// Used to populate the indexed `p_tags` / `e_tags` columns on insert.
fn extract_tag_values(event: &Event, name: &str) -> Vec<String> {
    event
        .tags
        .iter()
        .filter(|t| t.first().map(String::as_str) == Some(name))
        .filter_map(|t| t.get(1).cloned())
        .collect()
}

/// Replaceable event kinds: only one event per pubkey+kind (NIP-01)
fn is_replaceable(kind: i32) -> bool {
    kind == 0 || kind == 3 || (kind >= 10000 && kind < 20000)
}

/// Addressable event kinds: only one event per pubkey+kind+d_tag (NIP-01)
fn is_addressable(kind: i32) -> bool {
    kind >= 30000 && kind < 40000
}

/// Store an event in the database.
/// Handles replaceable (kinds 0, 3, 10000-19999) and addressable (kinds 30000-39999)
/// events by replacing older versions for the same pubkey+kind (or pubkey+kind+d_tag).
pub async fn store_event(pool: &PgPool, event: &Event) -> anyhow::Result<bool> {
    let d_tag = event.get_tag_value("d");
    let h_tag = event.get_tag_value("h");
    let visibility = event.get_tag_value("visibility");
    let tags_json: Value = serde_json::to_value(&event.tags)?;

    // Extract p/e tag values into dedicated array columns for fast filtering
    // (RELAY_OPTIMIZATIONS §2). Mirrors the query-side `p_tags && $N` path.
    let p_tags = extract_tag_values(event, "p");
    let e_tags = extract_tag_values(event, "e");

    // For replaceable/addressable events, delete the older version first.
    // Only deletes if the new event is strictly newer (created_at >).
    // If the existing event is newer or same age, the delete matches nothing
    // and the subsequent insert will fail on the unique constraint — that's fine,
    // we return Ok(false) to indicate "duplicate/superseded".
    if is_replaceable(event.kind) {
        sqlx::query(
            "DELETE FROM relay.events WHERE pubkey = $1 AND kind = $2 AND created_at < $3",
        )
        .bind(&event.pubkey)
        .bind(event.kind)
        .bind(event.created_at)
        .execute(pool)
        .await
        .map_err(|e| {
            tracing::error!(kind = event.kind, error = %e, "Failed to delete old replaceable event");
            e
        })?;
    } else if is_addressable(event.kind) {
        if let Some(ref d) = d_tag {
            sqlx::query(
                "DELETE FROM relay.events WHERE pubkey = $1 AND kind = $2 AND d_tag = $3 AND created_at < $4",
            )
            .bind(&event.pubkey)
            .bind(event.kind)
            .bind(d)
            .bind(event.created_at)
            .execute(pool)
            .await
            .map_err(|e| {
                tracing::error!(kind = event.kind, error = %e, "Failed to delete old addressable event");
                e
            })?;
        }
    }

    let result = sqlx::query(
        r#"
        INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, d_tag, h_tag, visibility, p_tags, e_tags)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    .execute(pool)
    .await;

    match result {
        Ok(r) => Ok(r.rows_affected() > 0),
        Err(e) => {
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

/// Query events matching a filter with dynamic WHERE clauses
pub async fn query_events(pool: &PgPool, filter: &Filter, authed_pubkey: Option<&str>) -> anyhow::Result<Vec<Event>> {
    // Delegate NIP-50 full-text search to the dedicated handler
    if let Some(ref search_query) = filter.search {
        // Clamp to MAX_LIMIT so a search REQ can't tie up a DB connection (strfry
        // caps at 500). See RELAY_OPTIMIZATIONS §1.
        let limit = filter.limit.unwrap_or(100).min(MAX_QUERY_LIMIT);
        return crate::protocol::nip50::search_events(pool, search_query, limit).await;
    }

    let start = std::time::Instant::now();

    let mut conditions: Vec<String> = Vec::new();
    let mut param_counter: usize = 0;

    // We'll collect bind values in typed vecs and bind them in order.
    // Since sqlx doesn't support heterogeneous dynamic binding easily,
    // we build the query string with $N placeholders and bind in order.
    //
    // We track which parameters are which type so we can bind them correctly.
    enum BindValue {
        StringVec(Vec<String>),
        IntVec(Vec<i32>),
        Int64(i64),
    }
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

    // h_tags: WHERE h_tag = ANY($N)
    if !filter.h_tags.is_empty() {
        param_counter += 1;
        conditions.push(format!("h_tag = ANY(${param_counter})"));
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

    // Visibility access control: filter protected events based on authenticated pubkey.
    // - Private/unlisted events: only visible to author or p-tagged collaborators
    // - Space-scoped events (h_tag): only visible to author or space members
    // - Public events (no visibility, no h_tag): visible to everyone
    match authed_pubkey {
        Some(pk) => {
            param_counter += 1;
            let auth_param = param_counter;
            binds.push(BindValue::StringVec(vec![pk.to_string()]));

            // Private/unlisted: author or collaborator
            conditions.push(format!(
                "(visibility IS NULL OR pubkey = ${auth_param}[1] OR EXISTS (\
                    SELECT 1 FROM jsonb_array_elements(tags) t \
                    WHERE t->>0 = 'p' AND t->>1 = ${auth_param}[1]\
                ))"
            ));

            // Space-scoped: author or space member
            conditions.push(format!(
                "(h_tag IS NULL OR pubkey = ${auth_param}[1] OR EXISTS (\
                    SELECT 1 FROM app.space_members \
                    WHERE space_id = h_tag AND pubkey = ${auth_param}[1]\
                ))"
            ));
        }
        None => {
            // Unauthenticated: only public events (no visibility tag, no h_tag)
            conditions.push("visibility IS NULL".to_string());
            conditions.push("h_tag IS NULL".to_string());
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let limit = filter.limit.unwrap_or(MAX_QUERY_LIMIT).min(MAX_QUERY_LIMIT);
    let sql = format!(
        "SELECT id, pubkey, created_at, kind, tags, content, sig FROM relay.events {where_clause} ORDER BY created_at DESC LIMIT {limit}"
    );

    // Build the query and bind parameters in order
    let mut query = sqlx::query_as::<Postgres, EventRow>(&sql);

    for bind in &binds {
        match bind {
            BindValue::StringVec(v) => {
                query = query.bind(v);
            }
            BindValue::IntVec(v) => {
                query = query.bind(v);
            }
            BindValue::Int64(v) => {
                query = query.bind(v);
            }
        }
    }

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
