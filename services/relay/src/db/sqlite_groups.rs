//! SQLite-backed NIP-29 group store for the embedded in-process relay
//! (Decentralized Spaces M6). A parity mirror of the Postgres `group_store`,
//! adapted for SQLite:
//!   - `relay.`/`app.` schema prefixes dropped (single-file db),
//!   - `$1`/`$2` placeholders → `?`,
//!   - `ON CONFLICT DO NOTHING` → `INSERT OR IGNORE`,
//!   - `group_id = ANY($1)` → `IN (?, …)` via a `QueryBuilder`,
//!   - booleans stored as INTEGER 0/1.
//!
//! Crucially the embedded relay has **no `app.space_members`**: membership is
//! relay-native only. So `is_member`/`members_of` here are the relay-native arm
//! of `membership_source` — there is nothing to UNION against.
//!
//! The `groups`/`group_members`/`group_roles` tables are created by the schema
//! in [`super::sqlite::connect`].

use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use std::collections::HashSet;

/// Create a new NIP-29 group; the creator becomes a member + admin.
pub async fn create_group(
    pool: &SqlitePool,
    group_id: &str,
    name: &str,
    creator_pubkey: &str,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("INSERT OR IGNORE INTO groups (group_id, name) VALUES (?, ?)")
        .bind(group_id)
        .bind(name)
        .execute(&mut *tx)
        .await?;

    sqlx::query("INSERT OR IGNORE INTO group_members (group_id, pubkey) VALUES (?, ?)")
        .bind(group_id)
        .bind(creator_pubkey)
        .execute(&mut *tx)
        .await?;

    sqlx::query("INSERT OR IGNORE INTO group_roles (group_id, pubkey, role) VALUES (?, ?, 'admin')")
        .bind(group_id)
        .bind(creator_pubkey)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}

/// Does a group row already exist? (mirrors the platform-collision guard:
/// the embedded relay rejects a 9007 for an id it already hosts.)
pub async fn group_exists(pool: &SqlitePool, group_id: &str) -> anyhow::Result<bool> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM groups WHERE group_id = ?")
            .bind(group_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

/// Update group metadata, only overwriting fields that are `Some` (COALESCE
/// parity with the Postgres 9002 edit-metadata path).
pub async fn set_metadata(
    pool: &SqlitePool,
    group_id: &str,
    name: Option<&str>,
    picture: Option<&str>,
    about: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE groups SET \
            name    = COALESCE(?, name), \
            picture = COALESCE(?, picture), \
            about   = COALESCE(?, about) \
         WHERE group_id = ?",
    )
    .bind(name)
    .bind(picture)
    .bind(about)
    .bind(group_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Set the private/closed access flags (M5 gated reads).
pub async fn set_flags(
    pool: &SqlitePool,
    group_id: &str,
    is_private: bool,
    is_closed: bool,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE groups SET is_private = ?, is_closed = ? WHERE group_id = ?")
        .bind(is_private)
        .bind(is_closed)
        .bind(group_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Is the pubkey an admin of the group?
pub async fn is_admin(pool: &SqlitePool, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
    let row: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM group_roles WHERE group_id = ? AND pubkey = ? AND role = 'admin'",
    )
    .bind(group_id)
    .bind(pubkey)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

/// Promote a pubkey to admin (and ensure they're a member).
pub async fn add_admin(pool: &SqlitePool, group_id: &str, pubkey: &str) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT OR IGNORE INTO group_members (group_id, pubkey) VALUES (?, ?)")
        .bind(group_id)
        .bind(pubkey)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT OR IGNORE INTO group_roles (group_id, pubkey, role) VALUES (?, ?, 'admin')")
        .bind(group_id)
        .bind(pubkey)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Is the pubkey a member of the group? (relay-native only — no
/// `app.space_members` to UNION against on the embedded relay.)
pub async fn is_member(pool: &SqlitePool, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT 1 FROM group_members WHERE group_id = ? AND pubkey = ?")
            .bind(group_id)
            .bind(pubkey)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

/// Add a member to a group.
pub async fn add_member(pool: &SqlitePool, group_id: &str, pubkey: &str) -> anyhow::Result<()> {
    sqlx::query("INSERT OR IGNORE INTO group_members (group_id, pubkey) VALUES (?, ?)")
        .bind(group_id)
        .bind(pubkey)
        .execute(pool)
        .await?;
    Ok(())
}

/// Remove a member (and any roles they held).
pub async fn remove_member(pool: &SqlitePool, group_id: &str, pubkey: &str) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM group_members WHERE group_id = ? AND pubkey = ?")
        .bind(group_id)
        .bind(pubkey)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM group_roles WHERE group_id = ? AND pubkey = ?")
        .bind(group_id)
        .bind(pubkey)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Does any of the given group ids belong to a private (members-only-read)
/// group? Used to send an `auth-required` CLOSED to anonymous clients (NIP-42).
pub async fn any_private(pool: &SqlitePool, group_ids: &[String]) -> anyhow::Result<bool> {
    if group_ids.is_empty() {
        return Ok(false);
    }
    let mut qb: QueryBuilder<Sqlite> =
        QueryBuilder::new("SELECT 1 FROM groups WHERE is_private = 1 AND group_id IN (");
    let mut sep = qb.separated(", ");
    for id in group_ids {
        sep.push_bind(id.clone());
    }
    qb.push(") LIMIT 1");
    let row: Option<(i64,)> = qb.build_query_as().fetch_optional(pool).await?;
    Ok(row.is_some())
}

/// All members of a group.
pub async fn get_members(pool: &SqlitePool, group_id: &str) -> anyhow::Result<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT pubkey FROM group_members WHERE group_id = ?")
            .bind(group_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Admin pubkeys of a group (role = 'admin'), for the 39001 event.
pub async fn get_admins(pool: &SqlitePool, group_id: &str) -> anyhow::Result<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT pubkey FROM group_roles WHERE group_id = ? AND role = 'admin'")
            .bind(group_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Group metadata (name, picture, about, is_private, is_closed), for the 39000
/// event. `None` if the group doesn't exist.
pub async fn get_metadata(
    pool: &SqlitePool,
    group_id: &str,
) -> anyhow::Result<Option<(String, Option<String>, Option<String>, bool, bool)>> {
    let row = sqlx::query_as(
        "SELECT name, picture, about, is_private, is_closed FROM groups WHERE group_id = ?",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Is the group closed? `None` if the group doesn't exist.
pub async fn is_closed(pool: &SqlitePool, group_id: &str) -> anyhow::Result<Option<bool>> {
    let row: Option<(bool,)> =
        sqlx::query_as("SELECT is_closed FROM groups WHERE group_id = ?")
            .bind(group_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

/// Delete a group (member/role rows cascade via FK).
pub async fn delete_group(pool: &SqlitePool, group_id: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM groups WHERE group_id = ?")
        .bind(group_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// The set of group ids the pubkey belongs to (relay-native arm of
/// `membership_source::members_of`). Populates the broadcast-visibility cache.
pub async fn members_of(pool: &SqlitePool, pubkey: &str) -> anyhow::Result<HashSet<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT group_id FROM group_members WHERE pubkey = ?")
            .bind(pubkey)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let p = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(super::super::sqlite::SCHEMA).execute(&p).await.unwrap();
        p
    }

    #[tokio::test]
    async fn create_seeds_creator_as_admin_member() {
        let p = pool().await;
        create_group(&p, "g1", "Group One", "alice").await.unwrap();

        assert!(is_member(&p, "g1", "alice").await.unwrap());
        assert!(is_admin(&p, "g1", "alice").await.unwrap());
        assert!(group_exists(&p, "g1").await.unwrap());
        assert!(!group_exists(&p, "nope").await.unwrap());
        assert!(!is_member(&p, "g1", "bob").await.unwrap());
        assert!(!is_admin(&p, "g1", "bob").await.unwrap());
    }

    #[tokio::test]
    async fn add_and_remove_member_cascades_roles() {
        let p = pool().await;
        create_group(&p, "g1", "G", "alice").await.unwrap();
        add_member(&p, "g1", "bob").await.unwrap();
        add_admin(&p, "g1", "bob").await.unwrap();

        assert!(is_member(&p, "g1", "bob").await.unwrap());
        assert!(is_admin(&p, "g1", "bob").await.unwrap());

        let mut members = get_members(&p, "g1").await.unwrap();
        members.sort();
        assert_eq!(members, vec!["alice".to_string(), "bob".to_string()]);

        remove_member(&p, "g1", "bob").await.unwrap();
        assert!(!is_member(&p, "g1", "bob").await.unwrap());
        assert!(!is_admin(&p, "g1", "bob").await.unwrap()); // role cascaded
        assert_eq!(get_members(&p, "g1").await.unwrap(), vec!["alice".to_string()]);
    }

    #[tokio::test]
    async fn members_of_unions_across_groups() {
        let p = pool().await;
        create_group(&p, "g1", "G1", "alice").await.unwrap();
        create_group(&p, "g2", "G2", "bob").await.unwrap();
        add_member(&p, "g2", "alice").await.unwrap();

        let alice = members_of(&p, "alice").await.unwrap();
        assert_eq!(alice, HashSet::from(["g1".to_string(), "g2".to_string()]));
        let bob = members_of(&p, "bob").await.unwrap();
        assert_eq!(bob, HashSet::from(["g2".to_string()]));
    }

    #[tokio::test]
    async fn private_flag_drives_any_private() {
        let p = pool().await;
        create_group(&p, "pub", "Public", "alice").await.unwrap();
        create_group(&p, "priv", "Private", "alice").await.unwrap();
        set_flags(&p, "priv", true, true).await.unwrap();

        assert!(!any_private(&p, &["pub".into()]).await.unwrap());
        assert!(any_private(&p, &["priv".into()]).await.unwrap());
        assert!(any_private(&p, &["pub".into(), "priv".into()]).await.unwrap());
        assert!(!any_private(&p, &[]).await.unwrap());
    }

    #[tokio::test]
    async fn set_metadata_is_coalescing() {
        let p = pool().await;
        create_group(&p, "g1", "Original", "alice").await.unwrap();
        set_metadata(&p, "g1", None, Some("https://img/x.png"), Some("about text")).await.unwrap();

        let row: (String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT name, picture, about FROM groups WHERE group_id = ?",
        )
        .bind("g1")
        .fetch_one(&p)
        .await
        .unwrap();
        // name untouched (None), picture+about set.
        assert_eq!(row.0, "Original");
        assert_eq!(row.1.as_deref(), Some("https://img/x.png"));
        assert_eq!(row.2.as_deref(), Some("about text"));
    }
}
