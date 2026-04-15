use serde_json::Value;
use sqlx::{PgPool, Postgres};

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

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
    let channel_tag = event.get_tag_value("channel");
    let tags_json: Value = serde_json::to_value(&event.tags)?;

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
        INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, d_tag, h_tag, visibility)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        let limit = filter.limit.unwrap_or(100);
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

    // p_tags: WHERE tags @> '[["p", "VALUE"]]' -- use jsonb containment for each
    // For array-of-values, we use: EXISTS (SELECT 1 FROM jsonb_array_elements(tags) elem WHERE elem->>0 = 'p' AND elem->>1 = ANY($N))
    if !filter.p_tags.is_empty() {
        param_counter += 1;
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(tags) elem WHERE elem->>0 = 'p' AND elem->>1 = ANY(${param_counter}))"
        ));
        binds.push(BindValue::StringVec(filter.p_tags.clone()));
    }

    // e_tags: same pattern as p_tags
    if !filter.e_tags.is_empty() {
        param_counter += 1;
        conditions.push(format!(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(tags) elem WHERE elem->>0 = 'e' AND elem->>1 = ANY(${param_counter}))"
        ));
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

    let limit = filter.limit.unwrap_or(500).min(5000);
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
