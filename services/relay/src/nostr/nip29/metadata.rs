use sqlx::PgPool;

/// Generate kind:39000 group metadata event
pub async fn generate_group_metadata(pool: &PgPool, group_id: &str) -> anyhow::Result<Option<serde_json::Value>> {
    let row: Option<(String, Option<String>, Option<String>, bool, bool)> = sqlx::query_as(
        "SELECT name, picture, about, is_private, is_closed FROM relay.groups WHERE group_id = $1",
    )
    .bind(group_id)
    .fetch_optional(pool)
    .await?;

    let (name, picture, about, is_private, is_closed) = match row {
        Some(r) => r,
        None => return Ok(None),
    };

    let mut tags = vec![vec!["d".to_string(), group_id.to_string()]];
    if is_private {
        tags.push(vec!["private".to_string()]);
    }
    if is_closed {
        tags.push(vec!["closed".to_string()]);
    }

    let content = serde_json::json!({
        "name": name,
        "picture": picture,
        "about": about,
    });

    Ok(Some(serde_json::json!({
        "kind": 39000,
        "tags": tags,
        "content": content.to_string(),
    })))
}

/// Generate kind:39001 group admins event
pub async fn generate_group_admins(pool: &PgPool, group_id: &str) -> anyhow::Result<Option<serde_json::Value>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT pubkey FROM relay.group_roles WHERE group_id = $1 AND role = 'admin'",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await?;

    let mut tags = vec![vec!["d".to_string(), group_id.to_string()]];
    for (pubkey,) in &rows {
        tags.push(vec!["p".to_string(), pubkey.clone(), "admin".to_string()]);
    }

    Ok(Some(serde_json::json!({
        "kind": 39001,
        "tags": tags,
        "content": "",
    })))
}

/// Generate kind:39002 group members event
pub async fn generate_group_members(pool: &PgPool, group_id: &str) -> anyhow::Result<Option<serde_json::Value>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT pubkey FROM relay.group_members WHERE group_id = $1",
    )
    .bind(group_id)
    .fetch_all(pool)
    .await?;

    let mut tags = vec![vec!["d".to_string(), group_id.to_string()]];
    for (pubkey,) in &rows {
        tags.push(vec!["p".to_string(), pubkey.clone()]);
    }

    Ok(Some(serde_json::json!({
        "kind": 39002,
        "tags": tags,
        "content": "",
    })))
}
