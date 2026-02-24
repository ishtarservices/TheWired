use sqlx::{PgPool, Postgres};

use crate::nostr::event::Event;

/// Execute a NIP-50 full-text search query
pub async fn search_events(
    pool: &PgPool,
    query: &str,
    limit: i64,
) -> anyhow::Result<Vec<Event>> {
    let rows: Vec<EventRow> = sqlx::query_as::<Postgres, EventRow>(
        r#"
        SELECT id, pubkey, created_at, kind, tags, content, sig
        FROM relay.events
        WHERE search_tsv @@ plainto_tsquery('english', $1)
        ORDER BY ts_rank(search_tsv, plainto_tsquery('english', $1)) DESC
        LIMIT $2
        "#,
    )
    .bind(query)
    .bind(limit)
    .fetch_all(pool)
    .await?;

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

#[derive(sqlx::FromRow)]
struct EventRow {
    id: String,
    pubkey: String,
    created_at: i64,
    kind: i32,
    tags: serde_json::Value,
    content: String,
    sig: String,
}
