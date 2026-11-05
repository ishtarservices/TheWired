//! Write-path moderation lookup (Postgres only): is this event tombstoned, is
//! its author suspended or shadowed? One round trip per EVENT. The tables are
//! written by the backend's admin actions (migrations 006 + 008); see
//! `nostr::moderation_gate`.

use sqlx::PgPool;
use std::collections::HashSet;

/// What the operator has said about an event / its author.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ModerationState {
    /// The event id was removed by the operator (never stored again).
    pub tombstoned: bool,
    /// The author is suspended: writes refused (except kinds 5 / 62).
    pub suspended: bool,
    /// The author is shadowed: writes accepted and stored, served only to
    /// the author (migration 008).
    pub shadowed: bool,
}

pub async fn moderation_state(pool: &PgPool, event_id: &str, pubkey: &str) -> anyhow::Result<ModerationState> {
    let (tombstoned, mode): (bool, Option<String>) = sqlx::query_as(
        "SELECT \
           EXISTS (SELECT 1 FROM relay.tombstones WHERE event_id = $1 AND restored_at IS NULL), \
           (SELECT mode FROM relay.suspended_pubkeys WHERE pubkey = $2 AND lifted_at IS NULL)",
    )
    .bind(event_id)
    .bind(pubkey)
    .fetch_one(pool)
    .await?;
    Ok(ModerationState {
        tombstoned,
        suspended: mode.as_deref() == Some("suspended"),
        shadowed: mode.as_deref() == Some("shadowed"),
    })
}

/// Every currently shadowed pubkey — the live-broadcast filter's cache
/// (`AppState::shadowed`), refreshed by the sweeper.
pub async fn shadowed_pubkeys(pool: &PgPool) -> anyhow::Result<HashSet<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT pubkey FROM relay.suspended_pubkeys WHERE lifted_at IS NULL AND mode = 'shadowed'")
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(pk,)| pk).collect())
}

/// SQL predicate (no binds) that hides shadowed authors' rows from every
/// reader but the author. `pk_expr` is the SQL expression for the reader's
/// pubkey, or None for an anonymous connection. Shared by the stored-query
/// path and NIP-50 search so the two cannot drift.
pub fn pg_not_shadowed_predicate(pk_expr: Option<&str>) -> String {
    match pk_expr {
        Some(pk) => format!(
            "(pubkey = {pk} OR NOT EXISTS (SELECT 1 FROM relay.suspended_pubkeys s \
             WHERE s.pubkey = relay.events.pubkey AND s.lifted_at IS NULL AND s.mode = 'shadowed'))"
        ),
        None => "NOT EXISTS (SELECT 1 FROM relay.suspended_pubkeys s \
                 WHERE s.pubkey = relay.events.pubkey AND s.lifted_at IS NULL AND s.mode = 'shadowed')"
            .to_string(),
    }
}
