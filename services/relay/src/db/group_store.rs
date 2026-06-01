use sqlx::PgPool;

/// Create a new NIP-29 group
pub async fn create_group(
    pool: &PgPool,
    group_id: &str,
    name: &str,
    creator_pubkey: &str,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;

    sqlx::query("INSERT INTO relay.groups (group_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING")
        .bind(group_id)
        .bind(name)
        .execute(&mut *tx)
        .await?;

    // Creator becomes admin
    sqlx::query(
        "INSERT INTO relay.group_members (group_id, pubkey) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(group_id)
    .bind(creator_pubkey)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO relay.group_roles (group_id, pubkey, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING",
    )
    .bind(group_id)
    .bind(creator_pubkey)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Does a group with this id exist on the relay?
pub async fn group_exists(pool: &PgPool, group_id: &str) -> anyhow::Result<bool> {
    let row: Option<(i32,)> =
        sqlx::query_as("SELECT 1 FROM relay.groups WHERE group_id = $1 LIMIT 1")
            .bind(group_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

/// Check if a pubkey is an admin of a group
pub async fn is_admin(pool: &PgPool, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM relay.group_roles WHERE group_id = $1 AND pubkey = $2 AND role = 'admin')",
    )
    .bind(group_id)
    .bind(pubkey)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.0).unwrap_or(false))
}

/// Check if a pubkey is a member of a group
pub async fn is_member(pool: &PgPool, group_id: &str, pubkey: &str) -> anyhow::Result<bool> {
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM relay.group_members WHERE group_id = $1 AND pubkey = $2)",
    )
    .bind(group_id)
    .bind(pubkey)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| r.0).unwrap_or(false))
}

/// Add a member to a group
pub async fn add_member(pool: &PgPool, group_id: &str, pubkey: &str) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO relay.group_members (group_id, pubkey) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    )
    .bind(group_id)
    .bind(pubkey)
    .execute(pool)
    .await?;
    Ok(())
}

/// Remove a member from a group
pub async fn remove_member(pool: &PgPool, group_id: &str, pubkey: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM relay.group_members WHERE group_id = $1 AND pubkey = $2")
        .bind(group_id)
        .bind(pubkey)
        .execute(pool)
        .await?;

    // Also remove their roles
    sqlx::query("DELETE FROM relay.group_roles WHERE group_id = $1 AND pubkey = $2")
        .bind(group_id)
        .bind(pubkey)
        .execute(pool)
        .await?;

    Ok(())
}

/// Does any of the given group ids belong to a private (members-only-read) group?
/// Used to send an `auth-required` CLOSED to anonymous clients (NIP-42).
pub async fn any_private(pool: &PgPool, group_ids: &[String]) -> anyhow::Result<bool> {
    if group_ids.is_empty() {
        return Ok(false);
    }
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT EXISTS(SELECT 1 FROM relay.groups WHERE group_id = ANY($1) AND is_private = true)",
    )
    .bind(group_ids)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0).unwrap_or(false))
}

/// Get all members of a group
pub async fn get_members(pool: &PgPool, group_id: &str) -> anyhow::Result<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT pubkey FROM relay.group_members WHERE group_id = $1")
            .bind(group_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Get the admin pubkeys of a group (role = 'admin'), for the 39001 event.
pub async fn get_admins(pool: &PgPool, group_id: &str) -> anyhow::Result<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT pubkey FROM relay.group_roles WHERE group_id = $1 AND role = 'admin'",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// Fetch a group's metadata (name, picture, about, is_private, is_closed), for
/// the 39000 event. `None` if the group doesn't exist.
pub async fn get_metadata(
    pool: &PgPool,
    group_id: &str,
) -> anyhow::Result<Option<(String, Option<String>, Option<String>, bool, bool)>> {
    let row = sqlx::query_as(
        "SELECT name, picture, about, is_private, is_closed FROM relay.groups WHERE group_id = $1",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Is the group closed (join requests ignored)? `None` if the group doesn't exist.
pub async fn is_closed(pool: &PgPool, group_id: &str) -> anyhow::Result<Option<bool>> {
    let row: Option<(bool,)> =
        sqlx::query_as("SELECT is_closed FROM relay.groups WHERE group_id = $1")
            .bind(group_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|r| r.0))
}

/// Set the private/closed access flags.
pub async fn set_flags(
    pool: &PgPool,
    group_id: &str,
    is_private: bool,
    is_closed: bool,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE relay.groups SET is_private = $2, is_closed = $3 WHERE group_id = $1")
        .bind(group_id)
        .bind(is_private)
        .bind(is_closed)
        .execute(pool)
        .await?;
    Ok(())
}

/// Update group metadata, only overwriting fields that are `Some` (COALESCE).
pub async fn edit_metadata(
    pool: &PgPool,
    group_id: &str,
    name: Option<&str>,
    picture: Option<&str>,
    about: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE relay.groups \
         SET name = COALESCE($2, name), picture = COALESCE($3, picture), \
             about = COALESCE($4, about), updated_at = NOW() \
         WHERE group_id = $1",
    )
    .bind(group_id)
    .bind(name)
    .bind(picture)
    .bind(about)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a group row (member/role rows cascade via FK).
pub async fn delete_group(pool: &PgPool, group_id: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM relay.groups WHERE group_id = $1")
        .bind(group_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// SECURITY: does a backend-authoritative (platform / A-lite) space already own
/// this id? Used to refuse a colliding relay-native 9007 create. `app.*` being
/// absent (embedded SQLite relay) is treated as "no collision".
pub async fn platform_space_exists(pool: &PgPool, group_id: &str) -> anyhow::Result<bool> {
    let collides: Option<(i32,)> = sqlx::query_as("SELECT 1 FROM app.spaces WHERE id = $1 LIMIT 1")
        .bind(group_id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
    Ok(collides.is_some())
}
