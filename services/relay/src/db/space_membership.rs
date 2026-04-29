//! Per-connection cache of which spaces an authenticated pubkey belongs to.
//!
//! Reads from `app.space_members` (managed by the backend) so the per-broadcast
//! visibility filter and the per-REQ historical query consult the same source
//! of truth. Without this cache, h-tagged events would only ever reach
//! authors and explicitly p-tagged collaborators on the broadcast path —
//! members of a space never see live messages from other members.

use sqlx::PgPool;
use std::collections::HashSet;

/// Query the set of space IDs the given pubkey is a member of.
pub async fn query_for_pubkey(
    pool: &PgPool,
    pubkey: &str,
) -> sqlx::Result<HashSet<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT space_id FROM app.space_members WHERE pubkey = $1",
    )
    .bind(pubkey)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}
