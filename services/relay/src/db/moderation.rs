//! Write-path moderation lookup (Postgres only): is this event tombstoned, is
//! its author suspended? One round trip per EVENT. The tables are written by
//! the backend's admin actions (migration 006); see `nostr::moderation_gate`.

use sqlx::PgPool;

/// `(tombstoned, suspended)` for `event_id` / `pubkey`.
pub async fn moderation_state(pool: &PgPool, event_id: &str, pubkey: &str) -> anyhow::Result<(bool, bool)> {
    let row: (bool, bool) = sqlx::query_as(
        "SELECT \
           EXISTS (SELECT 1 FROM relay.tombstones WHERE event_id = $1 AND restored_at IS NULL), \
           EXISTS (SELECT 1 FROM relay.suspended_pubkeys WHERE pubkey = $2 AND lifted_at IS NULL)",
    )
    .bind(event_id)
    .bind(pubkey)
    .fetch_one(pool)
    .await?;
    Ok(row)
}
