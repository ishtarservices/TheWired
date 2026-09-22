use sqlx::{PgPool, Postgres};

use crate::nostr::event::Event;
use crate::nostr::wrap_gate::{ReadCtx, KIND_GIFT_WRAP};

/// Execute a NIP-50 full-text search query, applying the same visibility gating
/// as `query_events` (#18: search was previously ungated, leaking private/group
/// content to anonymous callers).
pub async fn search_events(
    pool: &PgPool,
    query: &str,
    limit: i64,
    authed_pubkey: Option<&str>,
) -> anyhow::Result<Vec<Event>> {
    search_events_ctx(pool, query, limit, &ReadCtx::plain(authed_pubkey)).await
}

/// Search under a full read context. Gift wraps are never searchable (their
/// content is ciphertext) and expired events are never served (NIP-40).
pub async fn search_events_ctx(
    pool: &PgPool,
    query: &str,
    limit: i64,
    ctx: &ReadCtx<'_>,
) -> anyhow::Result<Vec<Event>> {
    let limit = limit.clamp(0, 500);
    // $1 = query, $2 = limit, $3 = now, $4 = authed pubkey (when present).
    let visibility = match ctx.authed {
        Some(_) =>
            " AND (visibility IS NULL OR pubkey = $4 OR $4 = ANY(p_tags)) \
             AND (h_tag IS NULL OR pubkey = $4 \
                   OR h_tags && ARRAY(SELECT space_id FROM app.space_members WHERE pubkey = $4) \
                   OR h_tags && ARRAY(SELECT group_id FROM relay.group_members WHERE pubkey = $4))",
        None => " AND visibility IS NULL AND h_tag IS NULL",
    };
    let sql = format!(
        "SELECT id, pubkey, created_at, kind, tags, content, sig \
         FROM relay.events \
         WHERE search_tsv @@ plainto_tsquery('english', $1){visibility} \
           AND kind <> {KIND_GIFT_WRAP} \
           AND (expires_at IS NULL OR expires_at > $3) \
         ORDER BY ts_rank(search_tsv, plainto_tsquery('english', $1)) DESC \
         LIMIT $2"
    );
    let mut q = sqlx::query_as::<Postgres, EventRow>(&sql).bind(query).bind(limit).bind(ctx.now);
    if let Some(pk) = ctx.authed {
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
