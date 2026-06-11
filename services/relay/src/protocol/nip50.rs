use sqlx::{PgPool, Postgres};

use crate::nostr::event::Event;

/// Execute a NIP-50 full-text search query, applying the same visibility gating
/// as `query_events` (#18: search was previously ungated, leaking private/group
/// content to anonymous callers).
pub async fn search_events(
    pool: &PgPool,
    query: &str,
    limit: i64,
    authed_pubkey: Option<&str>,
) -> anyhow::Result<Vec<Event>> {
    let limit = limit.clamp(0, 500);
    // $1 = query, $2 = limit, $3 = authed pubkey (when present).
    let visibility = match authed_pubkey {
        Some(_) =>
            " AND (visibility IS NULL OR pubkey = $3 OR $3 = ANY(p_tags)) \
             AND (h_tag IS NULL OR pubkey = $3 \
                   OR EXISTS (SELECT 1 FROM app.space_members WHERE space_id = h_tag AND pubkey = $3) \
                   OR EXISTS (SELECT 1 FROM relay.group_members WHERE group_id = h_tag AND pubkey = $3))",
        None => " AND visibility IS NULL AND h_tag IS NULL",
    };
    let sql = format!(
        "SELECT id, pubkey, created_at, kind, tags, content, sig \
         FROM relay.events \
         WHERE search_tsv @@ plainto_tsquery('english', $1){visibility} \
         ORDER BY ts_rank(search_tsv, plainto_tsquery('english', $1)) DESC \
         LIMIT $2"
    );
    let mut q = sqlx::query_as::<Postgres, EventRow>(&sql).bind(query).bind(limit);
    if let Some(pk) = authed_pubkey {
        q = q.bind(pk.to_string());
    }
    let rows: Vec<EventRow> = q.fetch_all(pool).await?;

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
