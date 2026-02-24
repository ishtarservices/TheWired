use serde_json::Value;
use sqlx::{PgPool, Postgres};

use crate::nostr::event::Event;
use crate::nostr::filter::Filter;

/// Store an event in the database
pub async fn store_event(pool: &PgPool, event: &Event) -> anyhow::Result<bool> {
    let d_tag = event.get_tag_value("d");
    let h_tag = event.get_tag_value("h");
    let tags_json: Value = serde_json::to_value(&event.tags)?;

    let result = sqlx::query(
        r#"
        INSERT INTO relay.events (id, pubkey, created_at, kind, tags, content, sig, d_tag, h_tag)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Query events matching a filter with dynamic WHERE clauses
pub async fn query_events(pool: &PgPool, filter: &Filter) -> anyhow::Result<Vec<Event>> {
    // Delegate NIP-50 full-text search to the dedicated handler
    if let Some(ref search_query) = filter.search {
        let limit = filter.limit.unwrap_or(100);
        return crate::protocol::nip50::search_events(pool, search_query, limit).await;
    }

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
