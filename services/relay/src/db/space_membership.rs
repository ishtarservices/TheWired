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

/// Authoritative membership lookup used by the publish-side gate.
///
/// The per-connection HashSet cache exists for the *broadcast* path where a
/// per-event DB query would burn the relay. The publish path is much rarer
/// (one query per accepted EVENT) and *must* hit the DB so a kick takes
/// effect immediately, even if the kicked user holds an open WebSocket whose
/// cache is stale.
pub async fn is_space_member(
    pool: &PgPool,
    space_id: &str,
    pubkey: &str,
) -> sqlx::Result<bool> {
    let row: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 FROM app.space_members WHERE space_id = $1 AND pubkey = $2 LIMIT 1",
    )
    .bind(space_id)
    .bind(pubkey)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}
