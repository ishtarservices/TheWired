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

/// Get all members of a group
pub async fn get_members(pool: &PgPool, group_id: &str) -> anyhow::Result<Vec<String>> {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT pubkey FROM relay.group_members WHERE group_id = $1")
            .bind(group_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}
