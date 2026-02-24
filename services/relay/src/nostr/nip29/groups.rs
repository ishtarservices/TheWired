use sqlx::PgPool;

use crate::nostr::event::Event;

/// Handle kind:9007 -- Create group
pub async fn handle_create_group(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = event
        .get_tag_value("h")
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let name = event.content.clone();

    crate::db::group_store::create_group(pool, &group_id, &name, &event.pubkey).await?;

    tracing::info!("Group created: {} by {}", group_id, event.pubkey);
    Ok(vec![format!(
        r#"["OK","{}",true,""]"#,
        event.id
    )])
}

/// Handle kind:9008 -- Delete group (admin only)
pub async fn handle_delete_group(pool: &PgPool, event: &Event) -> anyhow::Result<Vec<String>> {
    let group_id = match event.get_tag_value("h") {
        Some(id) => id,
        None => return Ok(vec![format!(r#"["OK","{}",false,"missing h tag"]"#, event.id)]),
    };

    if !crate::db::group_store::is_admin(pool, &group_id, &event.pubkey).await? {
        return Ok(vec![format!(
            r#"["OK","{}",false,"not authorized"]"#,
            event.id
        )]);
    }

    sqlx::query("DELETE FROM relay.groups WHERE group_id = $1")
        .bind(&group_id)
        .execute(pool)
        .await?;

    tracing::info!("Group deleted: {} by {}", group_id, event.pubkey);
    Ok(vec![format!(r#"["OK","{}",true,""]"#, event.id)])
}
