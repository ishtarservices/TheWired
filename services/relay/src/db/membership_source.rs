//! Unified membership resolution across the relay's two group worlds.
//!
//! The `h`-tag is a single id namespace, but membership for a given group can
//! live in either of two places:
//!   - `app.space_members` — backend-authoritative (platform + decentralized
//!     A-lite spaces; written by the backend REST join path).
//!   - `relay.group_members` — relay-authoritative NIP-29-native groups
//!     (written by kinds 9007/9000/9001/9021/9022).
//!
//! A group id appears in at most one of these (platform ids are random hex from
//! the backend; native ids are created via 9007 into `relay.groups`), so a UNION
//! is correct and — crucially — leaves the platform/A-lite path byte-for-byte
//! unchanged (the `app.space_members` leg is exactly today's query).
//!
//! For the embedded SQLite relay (M6) there is no `app.space_members`; that
//! build will swap in a relay-native-only implementation behind this same API.

use sqlx::PgPool;
use std::collections::HashSet;

use crate::nostr::membership_gate::SpaceMembership;

/// Member if the pubkey is in `app.space_members` (backend) OR
/// `relay.group_members` (relay-native) for this group id.
pub async fn is_member(pool: &PgPool, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
    let row: Option<(i32,)> = sqlx::query_as(
        "SELECT 1 WHERE EXISTS (\
            SELECT 1 FROM app.space_members WHERE space_id = $1 AND pubkey = $2\
         ) OR EXISTS (\
            SELECT 1 FROM relay.group_members WHERE group_id = $1 AND pubkey = $2\
         )",
    )
    .bind(group_id)
    .bind(pubkey)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

/// The set of group ids the pubkey belongs to, unioned across both worlds.
/// Used to populate the per-connection broadcast-visibility cache on AUTH.
pub async fn members_of(pool: &PgPool, pubkey: &str) -> anyhow::Result<HashSet<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT space_id FROM app.space_members WHERE pubkey = $1 \
         UNION \
         SELECT group_id FROM relay.group_members WHERE pubkey = $1",
    )
    .bind(pubkey)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Three-way membership for the multi-space publish gate: does the relay
/// know this id at all (`app.spaces` ∪ `relay.groups`), and if so is the
/// pubkey a member (`app.space_members` ∪ `relay.group_members`)?
///
/// An id that exists in neither world is [`SpaceMembership::Unknown`] and is
/// ignored by the all-of gate (the space may be hosted on another relay).
pub async fn space_membership(
    pool: &PgPool,
    group_id: &str,
    pubkey: &str,
) -> anyhow::Result<SpaceMembership> {
    let row: (bool, bool) = sqlx::query_as(
        "SELECT \
            (EXISTS (SELECT 1 FROM app.spaces WHERE id = $1) \
             OR EXISTS (SELECT 1 FROM relay.groups WHERE group_id = $1)), \
            (EXISTS (SELECT 1 FROM app.space_members WHERE space_id = $1 AND pubkey = $2) \
             OR EXISTS (SELECT 1 FROM relay.group_members WHERE group_id = $1 AND pubkey = $2))",
    )
    .bind(group_id)
    .bind(pubkey)
    .fetch_one(pool)
    .await?;
    Ok(match row {
        (false, _) => SpaceMembership::Unknown,
        (true, false) => SpaceMembership::NonMember,
        (true, true) => SpaceMembership::Member,
    })
}
